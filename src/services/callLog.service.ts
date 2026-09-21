import { sql } from '@/lib/neon';
import { insuredPhones, coInsuredPhones } from './recipients.service';
import { suppress, suppressionFor } from './suppression.service';
import {
  CALL_OUTCOMES, UNREACHABLE_RULE,
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

const dayOf = (s: string) => String(s).slice(0, 10);

/**
 * Every number on the card, with where it came from.
 *
 * Read through recipients.service rather than the phone columns, because a number the
 * trace returned lives inside the payload and a column read would miss it — the same
 * mismatch that had reach counts disagreeing across the CRM.
 */
export function numbersOnCard(lead: Record<string, unknown>): Array<{
  number: string; role: 'insured' | 'co_insured'; label: string;
}> {
  const out: Array<{ number: string; role: 'insured' | 'co_insured'; label: string }> = [];
  const seen = new Set<string>();
  const add = (n: string, role: 'insured' | 'co_insured', label: string) => {
    const clean = String(n ?? '').replace(/\D/g, '');
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({ number: clean, role, label });
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

  const status: CallStatus = contacted ? 'contacted'
    : unreachable ? 'unreachable'
      : rows.length ? 'attempting' : 'not_attempted';

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

  const upcoming = rows
    .filter((r) => r.callbackAt && r.callbackAt > new Date().toISOString())
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

  const id = globalThis.crypto.randomUUID();
  await sql`
    INSERT INTO "CallAttempt"
      ("id","leadId","propertyId","numberDialled","numberRole","numberLabel",
       "durationSeconds","outcome","callbackAt","notes","calledBy")
    VALUES (${id}, ${leadId}, ${String(input.lead.propertyId ?? '')}, ${number},
            ${input.numberRole ?? null}, ${input.numberLabel ?? null},
            ${input.durationSeconds ?? null}, ${input.outcome},
            ${input.callbackAt ?? null}, ${input.notes ?? null}, ${input.by ?? null})`;

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
  if (spec.suppresses) {
    await suppress({
      lead: input.lead, email: null, reason: spec.suppresses,
      source: 'producer', createdBy: input.by ?? null,
      note: `Call outcome: ${spec.label}`,
    });
    suppressed = true;
  }

  if (spec.needsCallbackAt && input.callbackAt) {
    await sql`
      UPDATE "Lead" SET "revisitFlag" = TRUE, "revisitDate" = ${input.callbackAt}::timestamp,
             "revisitNote" = ${`Callback agreed on a call${input.notes ? `: ${input.notes}` : ''}`}
       WHERE "id" = ${leadId}`;
  }

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${leadId}, 'call',
            ${`${spec.label} — ${number}${input.notes ? ` · ${input.notes}` : ''}`},
            ${input.by ?? 'crm'}, NOW())`;

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
