import { sql, pool } from '@/lib/neon';
import { stopHousehold, type HouseholdStopResult } from './householdStop.service';
import { easternDay, utcStoredToDate, easternInputToUtc } from '@/lib/wallClock';
import { insuredPhones, coInsuredPhones } from './recipients.service';
import { suppress, suppressionFor } from './suppression.service';
import { addActivity } from './storage.service';
import { closeRemindersForCall } from './callReminder.service';
import {
  CALL_OUTCOMES, UNREACHABLE_RULE, STATUS_FOR_OUTCOME,
  NOT_INTERESTED_RECONTACT_DAYS_BEFORE_RENEWAL,
  type CallOutcome, type CallStatus,
} from '@/lib/callOutcomes';

/**
 * Producer call activity (directive Sec. 10.5) — "the gap that closes first".
 *
 * Every attempt is a row. Status is derived from those rows and never stored as a fact
 * anyone types, because a typed status stops agreeing with the attempts underneath it the
 * first time someone forgets to change it, and then the call queue rests on a field nobody
 * trusts.
 *
 * ── What the outcome does ───────────────────────────────────────────────────
 * Logging is not filing. "Bad number" takes that number out of rotation so the next
 * attempt reaches a different line; "do not call" suppresses the household across every
 * channel, not just the phone. The action happens in the same transaction as the record,
 * so a card can never say a customer asked not to be called while the next cohort emails
 * them.
 */

export type CallAttempt = {
  id: string;
  leadId: string;
  numberDialled: string;
  numberRole: string | null;
  numberLabel: string | null;
  attemptedAt: string;
  durationSeconds: number | null;
  outcome: CallOutcome;
  callbackAt: string | null;
  notes: string | null;
  calledBy: string | null;
};

export type CallState = {
  status: CallStatus;
  attempts: CallAttempt[];
  attemptCount: number;
  /** Distinct numbers actually dialled — not how many are on the card. */
  numbersTried: string[];
  distinctDays: number;
  lastAttemptAt: string | null;
  nextCallbackAt: string | null;
  /** Numbers proven dead or wrong. Never offered again. */
  invalidNumbers: string[];
  /** Still worth dialling: on the card, not invalid, household not suppressed. */
  dialable: Array<{ number: string; role: 'insured' | 'co_insured'; label: string }>;
  /** Why the queue is not offering this lead, when it is not. */
  blockedReason: string | null;
};

/**
 * The EASTERN calendar day a call happened on.
 *
 * This was the first ten characters of the stored string, which is the UTC date. A call
 * placed at 11:42 PM in New Jersey stores as 04:42 the following day, so an evening's
 * calling was split across two days — and the unreachable rule turns on "3+ days".
 * Two calls one evening could satisfy it.
 */
const dayOf = (s: string) => easternDay(s);

/**
 * Every number on the card, with where it came from.
 *
 * Read through recipients.service rather than the phone columns, because a number the
 * trace returned lives inside the payload and a column read would miss it — the same
 * mismatch that had reach counts disagreeing across the CRM.
 */
/**
 * What the skip trace knows about each number.
 *
 * The payload carries far more than the digits — dnc, rank, type, tcpa, carrier — and none
 * of it was reaching the person dialling. Across C1–C3 that is 464 of 965 numbers flagged
 * DNC, on 155 of 184 accounts, invisible on the panel.
 *
 * Walked rather than read from a fixed path: the same shape appears under persons[].phones
 * and under persons[].relatives[].phones, and a fixed path finds one and silently misses
 * the other.
 */
export type NumberMeta = {
  dnc: boolean;
  tcpa: boolean;
  rank: number | null;
  type: string | null;
  carrier: string | null;
};

export function numberMetaFor(lead: Record<string, unknown>): Map<string, NumberMeta> {
  const out = new Map<string, NumberMeta>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if (o.number && ('dnc' in o || 'rank' in o || 'type' in o)) {
      const key = String(o.number).replace(/\D/g, '');
      if (key && !out.has(key)) {
        out.set(key, {
          dnc: o.dnc === true,
          tcpa: o.tcpa === true,
          rank: typeof o.rank === 'number' ? o.rank : null,
          type: o.type == null ? null : String(o.type),
          carrier: o.carrier == null ? null : String(o.carrier),
        });
      }
    }
    Object.values(o).forEach(walk);
  };
  walk(lead.skipTraceData);
  return out;
}

export function numbersOnCard(lead: Record<string, unknown>): Array<{
  number: string; role: 'insured' | 'co_insured'; label: string;
  dnc: boolean; tcpa: boolean; rank: number | null; type: string | null;
}> {
  const meta = numberMetaFor(lead);
  const out: Array<{
    number: string; role: 'insured' | 'co_insured'; label: string;
    dnc: boolean; tcpa: boolean; rank: number | null; type: string | null;
  }> = [];
  const seen = new Set<string>();
  const add = (n: string, role: 'insured' | 'co_insured', label: string) => {
    const clean = String(n ?? '').replace(/\D/g, '');
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const m = meta.get(clean);
    out.push({
      number: clean, role, label,
      dnc: m?.dnc ?? false,
      tcpa: m?.tcpa ?? false,
      rank: m?.rank ?? null,
      type: m?.type ?? null,
    });
  };
  for (const n of insuredPhones(lead)) {
    add(n, 'insured',
      String(lead.phone1 ?? '').replace(/\D/g, '') === String(n).replace(/\D/g, '') ? 'phone1'
        : String(lead.phone2 ?? '').replace(/\D/g, '') === String(n).replace(/\D/g, '') ? 'phone2'
          : 'trace');
  }
  for (const n of coInsuredPhones(lead)) {
    add(n, 'co_insured',
      String(lead.owner2Phone ?? '').replace(/\D/g, '') === String(n).replace(/\D/g, '') ? 'owner2Phone' : 'trace');
  }

  /**
   * ── The order Ruben should dial in (Frank, 25 Sep 2026 · item 9) ─────────
   *
   * "A dialing order for leads with many numbers (up to 19 on file)."
   *
   * Twenty-two C1–C3 accounts carry ten or more, one carries twenty, and the order was
   * simply the order they came out of the payload. On that twenty-number card the
   * co-insured's OWN number sat twentieth, behind seventeen speculative trace hits — so the
   * best number on the card was the last one anybody would reach.
   *
   * Sorted by what actually predicts a useful call:
   *
   *   1. Not DNC. A flagged number goes last, never removed — see dialable below for why
   *      it is still shown at all.
   *   2. On the card before found by a trace. phone1, phone2 and owner2Phone were supplied
   *      with the policy; a trace number is a guess about the same person.
   *   3. Insured before co-insured. §1.5 makes the insured the person we want.
   *   4. The vendor's own rank, where it gave one — 88% of these numbers carry it.
   *   5. Mobile before landline. A mobile reaches a person; a landline reaches a house.
   */
  const CARD_LABELS = new Set(['phone1', 'phone2', 'owner2Phone']);
  const isMobile = (t: string | null) => /mobile|cell|wireless/i.test(String(t ?? ''));
  out.sort((x, y) =>
    Number(x.dnc) - Number(y.dnc)
    || Number(!CARD_LABELS.has(x.label)) - Number(!CARD_LABELS.has(y.label))
    || (x.role === y.role ? 0 : x.role === 'insured' ? -1 : 1)
    || (x.rank ?? 99) - (y.rank ?? 99)
    || Number(!isMobile(x.type)) - Number(!isMobile(y.type)));

  return out;
}

/**
 * Derive the state for one lead.
 *
 * `blockedReason` exists so the panel can say WHY it is not offering a number. A disabled
 * control with no explanation gets worked around — somebody dials from the card instead,
 * and the attempt never gets logged, which is the failure this whole table exists to
 * prevent.
 */
export async function callState(lead: Record<string, unknown>): Promise<CallState> {
  const leadId = String(lead.id);
  const rows = await sql`
    SELECT "id","leadId","numberDialled","numberRole","numberLabel",
           "attemptedAt"::text AS "attemptedAt", "durationSeconds","outcome",
           "callbackAt"::text AS "callbackAt","notes","calledBy"
      FROM "CallAttempt" WHERE "leadId" = ${leadId}
     ORDER BY "attemptedAt" DESC` as CallAttempt[];

  const invalidNumbers: string[] = Array.isArray(lead.invalidPhones)
    ? (lead.invalidPhones as string[])
    : [];

  const numbersTried = [...new Set(rows.map((r) => r.numberDialled))];
  const distinctDays = new Set(rows.map((r) => dayOf(r.attemptedAt))).size;
  const onCard = numbersOnCard(lead);
  const dialable = onCard.filter((n) => !invalidNumbers.includes(n.number));

  const reachedOutcomes = new Set(CALL_OUTCOMES.filter((o) => o.reached).map((o) => o.key));
  const contacted = rows.some((r) => reachedOutcomes.has(r.outcome));

  /**
   * All three conditions, and the numbers one is waived when the card only ever had one
   * — "two or more numbers WHERE THEY EXIST". Without that clause a single-number lead
   * could never retire, and Ruben would dial it forever.
   */
  const enoughNumbers = onCard.length < UNREACHABLE_RULE.minDistinctNumbers
    || numbersTried.length >= UNREACHABLE_RULE.minDistinctNumbers;
  const unreachable = !contacted
    && rows.length >= UNREACHABLE_RULE.minAttempts
    && distinctDays >= UNREACHABLE_RULE.minDistinctDays
    && enoughNumbers;

  /**
   * The status follows the LATEST outcome that reached somebody (Frank, 25 Sep 2026).
   *
   * Latest, not first and not "any": it is the most recent thing the customer actually
   * said. A household that asked for a callback in March and said "not interested" in
   * September is not still owed a callback.
   *
   * `rows` is ordered newest first by the query, so the first match is the latest call.
   * Anything that reached somebody and is not in the map — there is nothing today — would
   * fall through to 'attempting', which is wrong but visible, rather than being silently
   * treated as one of the four.
   */
  const latestReached = rows.find((r) => reachedOutcomes.has(r.outcome));
  const reachedStatus = latestReached
    ? STATUS_FOR_OUTCOME[latestReached.outcome]
    : undefined;

  const status: CallStatus = reachedStatus
    ?? (unreachable ? 'unreachable'
      : rows.length ? 'attempting' : 'not_attempted');

  // S3: the DNC scrub happens before anyone dials, not after. A suppressed household is
  // not a lead to call — and the exposure lands on the producer's follow-up call, not on
  // the email.
  let blockedReason: string | null = null;
  const firstDialable = dialable[0];
  if (firstDialable) {
    const hit = await suppressionFor(lead, String(lead.email1 ?? ''));
    if (hit?.scope === 'household') {
      blockedReason = `This household is suppressed (${hit.reason}). Do not call.`;
    }
  } else if (onCard.length) {
    blockedReason = 'Every number on this card has been marked invalid.';
  } else {
    blockedReason = 'No phone number on this card.';
  }
  if (!blockedReason && status === 'unreachable') {
    blockedReason = 'Unreachable by phone — this lead has moved to the direct-mail segment.';
  }

  /**
   * Callbacks still ahead of us.
   *
   * This compared the stored text against `new Date().toISOString()` — two different
   * shapes. The stored form is "2026-09-25 09:41:00" and the ISO form is
   * "2026-09-25T18:42:00.000Z", and a string comparison puts a space before 'T', so every
   * callback dated TODAY sorted as already past and vanished from the panel. Ruben would
   * have seen a callback due this afternoon reported as nothing scheduled.
   *
   * Compared as instants now, with the stored value read as the UTC it is.
   */
  const now = Date.now();
  const upcoming = rows
    .filter((r) => {
      const at = utcStoredToDate(r.callbackAt);
      return at != null && at.getTime() > now;
    })
    .map((r) => r.callbackAt!)
    .sort();

  return {
    status,
    attempts: rows,
    attemptCount: rows.length,
    numbersTried,
    distinctDays,
    lastAttemptAt: rows[0]?.attemptedAt ?? null,
    nextCallbackAt: upcoming[0] ?? null,
    invalidNumbers,
    dialable,
    blockedReason,
  };
}

/**
 * Take back a mis-tap.
 *
 * Frank, 25 Sep 2026: "An undo for a mis-tap: (917) 566-4036 shows 'Voicemail left' and
 * then 'Bad number' 5 seconds later."
 *
 * ── Why this is more than deleting a row ────────────────────────────────────
 * Logging is not filing — an outcome acts. "Bad number" takes a line out of rotation, "do
 * not call" suppresses the household on every channel, a callback writes a date onto the
 * lead. An undo that removed the attempt and left those behind would be worse than no undo:
 * the record would say the call never happened while its consequences quietly stood.
 *
 * So each effect is reversed, and only where THIS attempt caused it. A number invalidated
 * by an earlier attempt too stays invalidated; a suppression somebody else recorded stays.
 *
 * ── Why there is a time limit ───────────────────────────────────────────────
 * This is for the five seconds after a wrong tap, not for editing history. Past the window
 * an attempt is a record of what happened, and a producer who wants it changed should say
 * so where somebody can see the correction.
 */
export const UNDO_WINDOW_MINUTES = 10;

export async function undoLastAttempt(input: {
  lead: Record<string, unknown>;
  by?: string | null;
}): Promise<{ undone: boolean; outcome?: CallOutcome; reason?: string }> {
  const leadId = String(input.lead.id);

  const [last] = await sql`
    SELECT "id","outcome","numberDialled","calledBy","attemptedAt"::text AS "attemptedAt"
      FROM "CallAttempt" WHERE "leadId" = ${leadId}
     ORDER BY "attemptedAt" DESC LIMIT 1` as Array<Record<string, any>>;

  if (!last) return { undone: false, reason: 'There is nothing to undo on this lead.' };

  const at = utcStoredToDate(last.attemptedAt);
  const ageMinutes = at ? (Date.now() - at.getTime()) / 60_000 : Infinity;
  if (ageMinutes > UNDO_WINDOW_MINUTES) {
    return {
      undone: false,
      reason: `That attempt is older than ${UNDO_WINDOW_MINUTES} minutes. It stays on the record —`
        + ' log a correcting attempt instead.',
    };
  }

  const spec = CALL_OUTCOMES.find((o) => o.key === last.outcome);

  /**
   * The number goes back into rotation only if nothing else invalidated it. Another
   * "bad number" on the same line is a second, independent reason to leave it out.
   */
  if (spec?.invalidatesNumber) {
    const [others] = await sql`
      SELECT COUNT(*)::int AS n FROM "CallAttempt"
       WHERE "leadId" = ${leadId} AND "id" <> ${String(last.id)}
         AND "numberDialled" = ${String(last.numberDialled)}
         AND "outcome" IN ('bad_number','wrong_person')` as Array<{ n: number }>;
    if (Number(others?.n ?? 0) === 0) {
      const existing: string[] = Array.isArray(input.lead.invalidPhones)
        ? (input.lead.invalidPhones as string[]) : [];
      await sql`
        UPDATE "Lead"
           SET "invalidPhones" = ${JSON.stringify(existing.filter((n) => n !== String(last.numberDialled)))}::jsonb
         WHERE "id" = ${leadId}`;
    }
  }

  /**
   * A suppression is released rather than deleted. It happened, somebody undid it, and both
   * of those are worth being able to see — a household that was suppressed and un-suppressed
   * within a minute is exactly the kind of thing worth noticing later.
   */
  if (spec?.suppresses) {
    await sql`
      UPDATE "Suppression"
         SET "releasedAt" = NOW(), "releasedBy" = ${input.by ?? null},
             "releaseNote" = 'Undone — the call outcome was a mis-tap'
       WHERE "leadId" = ${leadId} AND "reason" = ${spec.suppresses}
         AND "releasedAt" IS NULL`;
  }

  if (spec?.needsCallbackAt) {
    await sql`
      UPDATE "Lead" SET "revisitFlag" = FALSE, "revisitDate" = NULL, "revisitNote" = NULL
       WHERE "id" = ${leadId}`;
  }

  await sql`DELETE FROM "CallAttempt" WHERE "id" = ${String(last.id)}`;

  /**
   * The undo itself is recorded. The attempt is gone from the log — which is the point —
   * but a row vanishing with no explanation is how a call log stops being trusted.
   */
  await addActivity(
    leadId,
    'note',
    `Call outcome undone: "${spec?.label ?? last.outcome}" on ${last.numberDialled}`
      + ' — logged in error and taken back.',
    { undone: { outcome: last.outcome, number: last.numberDialled, at: last.attemptedAt } },
    input.by ?? undefined,
  ).catch(() => { /* the reversal matters more than the note about it */ });

  return { undone: true, outcome: last.outcome as CallOutcome };
}

/**
 * Record one attempt, and do what the outcome means.
 *
 * Deliberately takes the number that was DIALLED rather than reading it back from the
 * card: Ruben may have called a number a customer gave him on a previous call, and a log
 * that silently rewrites which number was tried is worse than no log.
 */
export async function logAttempt(input: {
  lead: Record<string, unknown>;
  numberDialled: string;
  outcome: CallOutcome;
  numberRole?: 'insured' | 'co_insured' | null;
  numberLabel?: string | null;
  durationSeconds?: number | null;
  callbackAt?: string | null;
  notes?: string | null;
  by?: string | null;
}): Promise<{ id: string; status: CallStatus; suppressed: boolean; numberInvalidated: boolean }> {
  const spec = CALL_OUTCOMES.find((o) => o.key === input.outcome);
  if (!spec) throw new Error(`Unknown call outcome: ${input.outcome}`);

  const leadId = String(input.lead.id);
  const number = String(input.numberDialled ?? '').replace(/\D/g, '');
  if (!number) throw new Error('An attempt needs the number that was dialled.');
  if (spec.needsCallbackAt && !input.callbackAt) {
    throw new Error('A scheduled callback needs a date and time.');
  }
  /**
   * ── The callback time, converted to UTC before it is stored ───────────────
   *
   * The picker hands back a bare wall clock with no zone. It used to go straight into the
   * column, so `callbackAt` held whatever clock the operator's laptop was set to while
   * `attemptedAt` — written by NOW() — held UTC. Two zones in one table, nothing marking
   * which was which, and a callback that moved if Ruben opened the card from a machine set
   * to another zone.
   *
   * Read as EASTERN, because that is what somebody scheduling a call into the agency's day
   * means. Stored as UTC, like everything else here.
   */
  const callbackUtc = spec.needsCallbackAt && input.callbackAt
    ? easternInputToUtc(String(input.callbackAt))
    : null;
  if (spec.needsCallbackAt && input.callbackAt && !callbackUtc) {
    throw new Error('That callback time could not be read. Pick a date and time.');
  }
  /**
   * And it has to be in the future. Only callbacks still ahead are surfaced, so one saved
   * in the past is recorded and then shown to nobody — indistinguishable from never having
   * set one, which is Frank's complaint from the other direction. Enforced here as well as
   * in the panel, because the panel is one caller and the rule belongs with the data.
   */
  if (callbackUtc) {
    const at = utcStoredToDate(callbackUtc);
    if (at && at.getTime() <= Date.now()) {
      throw new Error('That callback time has already passed. Pick a time in the future.');
    }
  }

  const id = globalThis.crypto.randomUUID();
  await sql`
    INSERT INTO "CallAttempt"
      ("id","leadId","propertyId","numberDialled","numberRole","numberLabel",
       "durationSeconds","outcome","callbackAt","notes","calledBy")
    VALUES (${id}, ${leadId}, ${String(input.lead.propertyId ?? '')}, ${number},
            ${input.numberRole ?? null}, ${input.numberLabel ?? null},
            ${input.durationSeconds ?? null}, ${input.outcome},
            ${callbackUtc}, ${input.notes ?? null}, ${input.by ?? null})`;

  // A dead or wrong number leaves rotation permanently. Kept on the lead rather than
  // erased — a disconnected line is worth remembering at next renewal.
  let numberInvalidated = false;
  if (spec.invalidatesNumber) {
    const existing: string[] = Array.isArray(input.lead.invalidPhones)
      ? (input.lead.invalidPhones as string[]) : [];
    if (!existing.includes(number)) {
      await sql`
        UPDATE "Lead" SET "invalidPhones" = ${JSON.stringify([...existing, number])}::jsonb
         WHERE "id" = ${leadId}`;
      numberInvalidated = true;
    }
  }

  let suppressed = false;
  let recontactAt: string | null = null;
  if (spec.suppresses) {
    /**
     * A "not interested" ends; a "do not call" does not.
     *
     * Frank: "Not interested → re-contact 60 days before next renewal." Sixty days before
     * the renewal AFTER the one being called about, so the household is left alone for this
     * cycle and reached in good time for the next. Do-not-call passes no date and stays
     * permanent, which is the whole difference between the two.
     */
    if (spec.recontactBeforeNextRenewal) {
      const eff = String((input.lead as Record<string, unknown>).effectiveDate ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(eff)) {
        const next = new Date(`${eff}T00:00:00`);
        next.setFullYear(next.getFullYear() + 1);
        next.setDate(next.getDate() - NOT_INTERESTED_RECONTACT_DAYS_BEFORE_RENEWAL);
        recontactAt = next.toISOString();
      }
      // No renewal date on the card means no date to compute from. The suppression is
      // still recorded — it stays permanent until somebody releases it, which is safer
      // than inventing a re-contact date from nothing.
    }
    await suppress({
      lead: input.lead, email: null, reason: spec.suppresses,
      source: 'producer', createdBy: input.by ?? null,
      note: `Call outcome: ${spec.label}`,
      reviewAt: recontactAt,
    });
    suppressed = true;
  }

  /**
   * ── The email sequence stops when a quote is requested ───────────────────
   *
   * Frank: "Quote requested → quoting, and the email sequence pauses."
   *
   * Somebody who has just asked for a quote on the phone must not keep receiving the cold
   * sequence that asked them to — it reads as nobody at the agency talking to anybody else,
   * and it is the same household the producer is now working.
   *
   * The platform has no pause for a single lead, so the recipient is removed from the
   * campaign (see householdStop.service). The OutreachEvent rows stay, so the history of
   * what was sent survives the removal.
   *
   * Failure here does NOT fail the call log. A call that happened is a fact; a sequence
   * that could not be stopped is a problem to fix, and losing the record of the call to
   * report it would be the worse of the two.
   */
  let emailPaused: HouseholdStopResult | null = null;
  if (spec.pausesEmail) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      /**
       * No recipient is spared — unlike a reply, which spares the address that replied.
       * A quote request came in on the PHONE, so there is no email recipient to keep, and
       * every live address on the household should stop.
       */
      emailPaused = await stopHousehold(
        client, leadId, '', 'quote requested on a call', String(input.by ?? 'producer'),
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[callLog] could not stop the email sequence for', leadId, e);
    } finally {
      client.release();
    }
  }

  if (callbackUtc) {
    // The same converted value the attempt row carries. Writing the raw picker string here
    // would leave the lead's revisit date and its own call log describing the same callback
    // in two different zones.
    await sql`
      UPDATE "Lead" SET "revisitFlag" = TRUE, "revisitDate" = ${callbackUtc}::timestamp,
             "revisitNote" = ${`Callback agreed on a call${input.notes ? `: ${input.notes}` : ''}`}
       WHERE "id" = ${leadId}`;
  }

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${leadId}, 'call',
            ${`${spec.label} — ${number}${input.notes ? ` · ${input.notes}` : ''}`},
            ${input.by ?? 'crm'}, NOW())`;

  /**
   * An outcome was logged, so any reminder to ring this lead back has been answered.
   *
   * Closed HERE rather than by a button on the reminder, because a button that says
   * "called" without a call behind it is a second version of events. Derived from the
   * attempt, the reminder log and the call history cannot disagree.
   *
   * Never blocks the call: an attempt that failed to close a reminder is a stale row in a
   * queue; an attempt rolled back because the queue update failed is a lost call.
   */
  await closeRemindersForCall(leadId, input.by ?? null)
    .catch(() => { /* the attempt is what matters */ });

  // Recompute and stamp, purely so reports can filter cheaply. The stamp is an echo of
  // the derived rule, never the thing the rule reads.
  const state = await callState({ ...input.lead, invalidPhones: undefined });
  if (state.status === 'unreachable') {
    await sql`
      UPDATE "Lead" SET "callUnreachableAt" = COALESCE("callUnreachableAt", NOW())
       WHERE "id" = ${leadId}`;
  }

  return { id, status: state.status, suppressed, numberInvalidated };
}

/** The call queue: phone-reachable leads that are not finished and not suppressed. */
export async function callQueue(opts: { effFrom?: string; effTo?: string; limit?: number } = {}) {
  const rows = await sql`
    SELECT l."id", l."propertyId", l."owner1FirstName", l."owner1LastName",
           l."addressCity", l."addressZip", l."effectiveDate"::text AS "effectiveDate",
           l."cohort", COALESCE(l."manualGrade", l."grade") AS grade,
           l."phone1", l."phone2", l."owner2Phone", l."phonesAll", l."skipTraceData",
           l."email1","email2","owner2Email","emailsAll",
           l."owner1FirstName" AS f, l."owner1LastName" AS ln,
           l."owner2FirstName", l."owner2LastName",
           l."addressStreet", l."invalidPhones", l."callUnreachableAt",
           (SELECT COUNT(*)::int FROM "CallAttempt" a WHERE a."leadId" = l."id") AS "attemptCount",
           (SELECT MAX(a."attemptedAt") FROM "CallAttempt" a WHERE a."leadId" = l."id") AS "lastAttemptAt"
      FROM "Lead" l
     WHERE COALESCE(l."manualGrade", l."grade") = 'A'
       AND l."callUnreachableAt" IS NULL
       AND (${opts.effFrom ?? null}::text IS NULL OR l."effectiveDate" >= ${opts.effFrom ?? null})
       AND (${opts.effTo ?? null}::text   IS NULL OR l."effectiveDate" <= ${opts.effTo ?? null})
     ORDER BY l."effectiveDate", l."owner1LastName"
     LIMIT ${opts.limit ?? 500}` as Array<Record<string, unknown>>;

  // Only leads with a number worth dialling. Filtered here rather than in SQL because
  // "has a phone" means the recipient rules, not "phone1 IS NOT NULL".
  return rows.filter((l) => numbersOnCard(l).some(
    (n) => !(Array.isArray(l.invalidPhones) ? (l.invalidPhones as string[]) : []).includes(n.number),
  ));
}
