import { sql } from '@/lib/neon';
import { householdScopeKey } from './household.service';

/**
 * Suppression, held in the CRM (directive S2, Sec. 7.1, Sec. 12).
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Two scopes, and the difference decides whether the next address on the card may be used:
 *
 *   address    — this mailbox only. A hard bounce is this: the person did not refuse us,
 *                the mailbox is dead. Sec. 12: "address flagged invalid and suppressed,
 *                kept on record; next valid address used."
 *   household  — everyone on the card, every channel, indefinitely. Opt-outs, complaints,
 *                "stop" replies and DNC are this. Sec. 12: "whole household suppressed."
 *
 * Collapsing the two is the expensive mistake in both directions: treat a bounce as a
 * household suppression and a live household is abandoned over a dead mailbox; treat an
 * opt-out as address-level and the co-insured keeps receiving mail from a household that
 * told us to stop.
 *
 * ── Checked at send time ────────────────────────────────────────────────────
 * Sec. 7.1: "Suppression checked at send time, not only when the batch is built." The gap
 * is real — a batch staged at 4pm and sent at 11:15 the next morning has nineteen hours in
 * which somebody can unsubscribe, and the send would not know.
 */

export type SuppressionScope = 'address' | 'household';

export type SuppressionReason =
  | 'unsubscribe'     // one-click header, or an opt-out CTA
  | 'complaint'       // marked as spam — the most expensive signal we get
  | 'hard_bounce'     // the mailbox does not exist. ADDRESS scope, never household
  | 'not_interested'  // said no in a reply
  | 'dnc'             // do-not-call / do-not-contact, incl. the scrub before outbound
  | 'bound'           // they bought. Now a customer, and cold outreach must stop
  | 'manual';         // a person decided; `note` says why

/**
 * Reasons that always mean the whole household, whatever the caller passes.
 *
 * `bound` belongs here for a different reason from the rest. The others are refusals, and
 * a refusal by one person on a card speaks for the address. A bind is not a refusal — it
 * is the outcome we wanted — but a policy covers the PROPERTY, so every address on that
 * card now belongs to a customer. Suppressing only the mailbox that answered would leave
 * the co-insured being cold-emailed about a policy their household has just bought, which
 * is the single most embarrassing message this system could send.
 */
const ALWAYS_HOUSEHOLD = new Set<SuppressionReason>(['unsubscribe', 'complaint', 'not_interested', 'dnc', 'bound']);
/** Reasons that are always about one mailbox. */
const ALWAYS_ADDRESS = new Set<SuppressionReason>(['hard_bounce']);

/**
 * The scope a reason implies.
 *
 * Not taken from the caller, because the caller is usually a webhook handler translating a
 * vendor's vocabulary, and the vendor has no concept of a household. Deriving it here means
 * the rule is stated once and cannot be got wrong per integration.
 */
export function scopeForReason(reason: SuppressionReason, requested?: SuppressionScope): SuppressionScope {
  if (ALWAYS_HOUSEHOLD.has(reason)) return 'household';
  if (ALWAYS_ADDRESS.has(reason)) return 'address';
  return requested ?? 'household';
}

export type SuppressInput = {
  lead?: Record<string, unknown> | null;
  leadId?: string | null;
  email?: string | null;
  reason: SuppressionReason;
  scope?: SuppressionScope;
  source?: string;
  createdBy?: string | null;
  note?: string | null;
};

/**
 * The household key for a suppression, resolved against the database when the caller's
 * lead object does not carry one.
 *
 * ── Why this is not just `lead.householdId ?? derive(lead)` ─────────────────
 * Callers build their lead from whatever columns they happened to need. recordBind
 * selects eight, replies.service selects three, the webhook builds a literal from a join.
 * None of them included "householdId", so householdScopeKey fell back to the address key
 * and wrote a suppression under a string no reader looks up any more — a stop that
 * records successfully, reports successfully, and silently never fires.
 *
 * Reading it here removes the whole class: a partial SELECT can no longer produce the
 * wrong key, because the key does not come from the caller's object at all unless it is
 * genuinely there. Costs one indexed lookup on a path that runs once per suppression, not
 * once per recipient — the bulk send-time check is loadActiveSuppressions, which is
 * unaffected.
 */
async function householdKeyForSuppression(
  lead: Record<string, unknown> | null | undefined,
  leadId: string | null,
): Promise<string | null> {
  const onObject = String(lead?.householdId ?? '').trim();
  if (onObject) return onObject;

  if (leadId) {
    const [row] = await sql`
      SELECT "householdId" FROM "Lead" WHERE "id" = ${leadId}` as Array<{ householdId: string | null }>;
    if (row?.householdId) return String(row.householdId);
  }
  // No stored household yet — a lead a pull has just created. The address key keeps it
  // suppressible, and materialiseHouseholds rewrites this row when it assigns the id.
  return lead ? householdScopeKey(lead) : null;
}

/** Record a suppression. Idempotent per (scope, key, reason) while it is still active. */
export async function suppress(input: SuppressInput): Promise<{ scope: SuppressionScope; created: boolean }> {
  const reason = input.reason;
  const scope = scopeForReason(reason, input.scope);
  const email = input.email ? input.email.toLowerCase().trim() : null;
  const leadId = input.leadId ?? (input.lead?.id ? String(input.lead.id) : null);
  const householdKey = scope === 'household'
    ? await householdKeyForSuppression(input.lead, leadId)
    : null;

  if (scope === 'address' && !email) {
    throw new Error('An address-scope suppression needs the address it applies to.');
  }
  if (scope === 'household' && !householdKey) {
    throw new Error('A household-scope suppression needs the lead, to derive the household.');
  }

  const existing = await sql`
    SELECT "id" FROM "Suppression"
     WHERE "releasedAt" IS NULL AND "reason" = ${reason}
       AND (${scope} = 'address' AND LOWER("email") = ${email}
            OR ${scope} = 'household' AND "householdKey" = ${householdKey})
     LIMIT 1` as Array<{ id: string }>;
  if (existing.length) return { scope, created: false };

  await sql`
    INSERT INTO "Suppression"
      ("id", "scope", "email", "householdKey", "leadId", "reason", "source", "createdBy", "note")
    VALUES
      (${globalThis.crypto.randomUUID()}, ${scope}, ${email}, ${householdKey}, ${leadId},
       ${reason}, ${input.source ?? 'crm'}, ${input.createdBy ?? null}, ${input.note ?? null})`;

  return { scope, created: true };
}

export type SuppressionHit = {
  scope: SuppressionScope;
  reason: string;
  createdAt: string;
  email: string | null;
};

/**
 * The send-time check for ONE recipient.
 *
 * Both scopes are tested: the address itself, and the household it belongs to. A household
 * suppression beats everything — if this household said stop, no address on it may be used,
 * including one that has never bounced and never opted out itself.
 */
export async function suppressionFor(
  lead: Record<string, unknown>,
  email: string,
): Promise<SuppressionHit | null> {
  const addr = email.toLowerCase().trim();
  // Resolved the same way it was written, so a partial lead object cannot make the
  // lookup ask for a different key than suppress() stored.
  const hk = await householdKeyForSuppression(lead, lead?.id ? String(lead.id) : null);
  const rows = await sql`
    SELECT "scope", "reason", "createdAt"::text AS "createdAt", "email"
      FROM "Suppression"
     WHERE "releasedAt" IS NULL
       AND (LOWER("email") = ${addr} OR "householdKey" = ${hk})
     ORDER BY CASE WHEN "scope" = 'household' THEN 0 ELSE 1 END, "createdAt"
     LIMIT 1` as SuppressionHit[];
  return rows[0] ?? null;
}

/**
 * Bulk form, for building a send list without one round trip per recipient.
 *
 * Returns the set of suppressed addresses and the set of suppressed household keys, so the
 * caller can test in memory. The per-recipient check above still runs at send time —
 * this one answers "who should we stage", that one answers "may this go out right now".
 */
export async function loadActiveSuppressions(): Promise<{
  emails: Set<string>;
  households: Set<string>;
  byEmail: Map<string, SuppressionHit>;
  byHousehold: Map<string, SuppressionHit>;
}> {
  const rows = await sql`
    SELECT "scope", "reason", "createdAt"::text AS "createdAt", LOWER("email") AS "email", "householdKey"
      FROM "Suppression" WHERE "releasedAt" IS NULL` as Array<SuppressionHit & { householdKey: string | null }>;

  const emails = new Set<string>();
  const households = new Set<string>();
  const byEmail = new Map<string, SuppressionHit>();
  const byHousehold = new Map<string, SuppressionHit>();
  for (const r of rows) {
    if (r.email) { emails.add(r.email); if (!byEmail.has(r.email)) byEmail.set(r.email, r); }
    if (r.householdKey) {
      households.add(r.householdKey);
      if (!byHousehold.has(r.householdKey)) byHousehold.set(r.householdKey, r);
    }
  }
  return { emails, households, byEmail, byHousehold };
}

/**
 * Engagement confirms an address (Sec. 7.1, Sec. 12).
 *
 * "Once an address is confirmed by engagement, only that address receives email — insured
 * and co-insured alike." So this is not a flag, it is a narrowing: from here the household
 * has exactly one usable address and every other one stops, including the insured's when
 * it was the co-insured who replied.
 *
 * `via` is never 'open'. Apple Mail and Gmail auto-open, so an open confirms nothing, and
 * E1 carries no pixel in any case (Frank, 21 Sep).
 */
export async function confirmAddress(opts: {
  leadId: string;
  email: string;
  via: 'reply' | 'click' | 'meeting';
  role?: 'insured' | 'co_insured' | null;
}): Promise<void> {
  await sql`
    UPDATE "Lead"
       SET "confirmedEmail" = ${opts.email.toLowerCase().trim()},
           "confirmedAt"    = NOW(),
           "confirmedVia"   = ${opts.via},
           "confirmedRole"  = ${opts.role ?? null}
     WHERE "id" = ${opts.leadId}`;
}

/** Undo a suppression. Recorded, never deleted — "was this household ever opted out?" has legal weight. */
export async function release(id: string, by: string | null, note: string | null): Promise<void> {
  await sql`
    UPDATE "Suppression"
       SET "releasedAt" = NOW(), "releasedBy" = ${by}, "releaseNote" = ${note}
     WHERE "id" = ${id} AND "releasedAt" IS NULL`;
}

/**
 * Transaction-aware form, for the webhook receiver.
 *
 * The receiver already holds an open transaction so that an outcome row and its parent
 * lead move together — "a reply recorded on one but not the other is exactly how a
 * suppressed lead gets mailed again". A suppression written through the tagged-template
 * `sql` above would sit OUTSIDE that transaction and could survive a rollback, leaving a
 * household suppressed by an event the CRM decided never happened.
 *
 * So the same rule runs, against the caller's client. `scopeForReason` is shared with the
 * function above, so the address/household decision is made in exactly one place no matter
 * which path recorded it.
 */
export async function suppressWithClient(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  input: SuppressInput & { householdKey?: string | null },
): Promise<{ scope: SuppressionScope; created: boolean }> {
  const reason = input.reason;
  const scope = scopeForReason(reason, input.scope);
  const email = input.email ? input.email.toLowerCase().trim() : null;
  const leadId = input.leadId ?? (input.lead?.id ? String(input.lead.id) : null);

  /**
   * The stored household wins over anything the caller worked out for itself.
   *
   * It used to be `input.householdKey ?? resolve(...)`, which reads as a sensible
   * override and was not: the campaign webhook computed a key from a lead literal holding
   * only id, street and zip, so it derived the ADDRESS key and passed it explicitly — and
   * the explicit value beat the resolver. Unsubscribes and complaints, the two most
   * consequential suppressions there are, were therefore recorded under a string no
   * reader asks for. It would have recorded cleanly, reported cleanly, and never fired.
   *
   * Resolved through the caller's client, not `sql`: this runs inside the webhook's
   * transaction, and a read on a different connection cannot see anything that
   * transaction has written.
   */
  let householdKey: string | null = null;
  if (scope === 'household') {
    const onObject = String(input.lead?.householdId ?? '').trim();
    if (onObject) householdKey = onObject;
    else if (leadId) {
      const { rows } = await client.query(
        `SELECT "householdId" FROM "Lead" WHERE "id" = $1`, [leadId],
      ) as { rows: Array<{ householdId: string | null }> };
      householdKey = rows[0]?.householdId ?? null;
    }
    // Only when the lead genuinely has no household yet. An explicitly supplied key is
    // the last resort, not the first choice.
    householdKey ??= input.householdKey
      ?? (input.lead ? householdScopeKey(input.lead) : null);
  }

  if (scope === 'address' && !email) return { scope, created: false };
  if (scope === 'household' && !householdKey) return { scope, created: false };

  const { rows } = await client.query(
    `SELECT "id" FROM "Suppression"
      WHERE "releasedAt" IS NULL AND "reason" = $1
        AND ($2 = 'address'   AND lower("email") = $3
          OR $2 = 'household' AND "householdKey" = $4)
      LIMIT 1`,
    [reason, scope, email, householdKey],
  );
  if (rows.length) return { scope, created: false };

  await client.query(
    `INSERT INTO "Suppression"
       ("id","scope","email","householdKey","leadId","reason","source","createdBy","note")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [globalThis.crypto.randomUUID(), scope, email, householdKey, leadId,
      reason, input.source ?? 'campaign_tool', input.createdBy ?? null, input.note ?? null],
  );
  return { scope, created: true };
}

/**
 * Does this reply text mean "stop"?
 *
 * Sec. 7.6 requires a stop reply to suppress the household immediately, but classifying a
 * reply is Ruben's job and most replies are ambiguous. This matches only the unmistakable
 * ones, so an automated suppression never fires on "stop sending me the condo one, just
 * the house" — everything short of explicit is left for a human to classify.
 *
 * Erring this way is deliberate: a missed auto-suppression is caught by Ruben within the
 * hour, while a false one silently deletes a live prospect and we never learn why.
 */
export function isExplicitStopReply(text: string | null | undefined): boolean {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return false;
  /**
   * A leading "stop" only counts when it is the WHOLE message.
   *
   * Matching /^stop\b/ auto-suppressed "stop sending me the condo one, just the house" —
   * a buying signal, from a household actively choosing which quote it wants, in a book
   * that is 82% condo. It would have deleted them silently, and the only visible trace
   * would have been a cohort that quietly under-delivered.
   *
   * Anything longer has to match one of the unambiguous phrases below instead.
   */
  const bare = s
    .replace(/[.!?,;:-]+/g, ' ')
    .replace(/\b(please|thanks|thank you|now|immediately|asap)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (/^(stop|unsubscribe|remove me|no thanks|not interested|opt out)$/.test(bare)) return true;

  return /\b(take me off|remove me from|stop (emailing|contacting|mailing) me|do not (email|contact) me|unsubscribe me)\b/.test(s);
}
