import { sql } from '@/lib/neon';
import { wallClockIso } from '@/lib/wallClock';

/**
 * Email verification results (Frank, 25 Sep 2026).
 *
 * "Add 'verified emails' column to QC cohort ledger inserted right next to 'mailable' to
 *  reflect Zero Bounce results... the non verified results need to speak directly back to
 *  the cards."
 *
 * ── What "verified" adds that "mailable" does not ───────────────────────────
 * Mailable means the CRM holds an address for the insured. Verified means a third party
 * checked that the mailbox exists. They are far apart: on C1–C3 the CRM holds an address for
 * 132 of the 178 rated accounts, and the 23 Sep verification passed only 106 of them. The 26
 * in between look reachable in every report we have and are not.
 *
 * Reporting the first as though it were the second is how a cohort under-delivers against
 * its own forecast, which is the same mistake the ledger already documents for aNow against
 * mailable — one row further down the same funnel.
 */

/**
 * Which verifier verdicts count as reachable.
 *
 * `valid` only. The others are each a different kind of not-knowing and none of them is a
 * reason to send:
 *
 *   catch-all  the domain accepts everything, so the mailbox may not exist. A bounce here
 *              is invisible until it is a reputation problem.
 *   unknown    the verifier could not complete the check.
 *   spamtrap   an address that exists to catch senders who do not clean their lists.
 *              Sending to one is worse than sending to a dead mailbox.
 *   abuse      a recipient who has reported mail as spam before.
 *   do_not_mail  role accounts, disposables, toxic domains.
 *
 * Kept as one list rather than a test scattered across readers: the ledger's count, the
 * call-first list and the send list must agree on what verified means, and a rule written
 * three times is a rule that differs three ways.
 */
export const DELIVERABLE_STATUSES = new Set(['valid']);

export function isDeliverable(status: string | null | undefined): boolean {
  return DELIVERABLE_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

/**
 * Verdicts that MUST NOT be mailed.
 *
 * Deliberately narrower than "not deliverable". Deliverable answers "may we count this as
 * reached"; this answers "would sending do harm", and the two are not complements:
 *
 *   invalid      the mailbox does not exist. Every send is a hard bounce, and hard bounces
 *                are what providers score a sending domain on.
 *   abuse        this recipient has reported mail as spam before. They are likely to again.
 *   spamtrap     an address that exists to catch senders who do not clean their lists.
 *                One send can blacklist a domain.
 *   do_not_mail  role accounts, disposables, toxic domains.
 *
 * catch-all and unknown are NOT here. They mean the verifier could not tell, which is not
 * evidence against the address — blocking them would drop reach on no finding. They simply
 * do not count as verified.
 *
 * An address with NO verdict is not blocked either. 616 addresses have never been submitted
 * to the verifier, and "not looked at" must never read as "bad".
 */
export const BLOCKING_STATUSES = new Set(['invalid', 'abuse', 'spamtrap', 'do_not_mail']);

export function isBlocked(status: string | null | undefined): boolean {
  return BLOCKING_STATUSES.has(String(status ?? '').trim().toLowerCase());
}

/**
 * Every address the verifier found a reason not to mail, as a lookup.
 *
 * One query, shared by the send list, the push and the export, so those three cannot
 * disagree about who is excluded — the failure that had two tabs of this CRM reporting 95
 * and 93 mailable for the same week.
 */
export async function blockedAddresses(): Promise<Map<string, string>> {
  const rows = await sql`
    SELECT "email","status" FROM "EmailVerification"
     WHERE lower("status") = ANY(${[...BLOCKING_STATUSES]})` as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [norm(r.email), String(r.status)]));
}

export type VerificationRow = {
  email: string;
  leadId: string | null;
  propertyId: string | null;
  cohort: string | null;
  personRole: string | null;
  status: string;
  subStatus: string | null;
  deliverable: boolean;
  source: string;
  batchLabel: string | null;
  verifiedAt: string | null;
};

const norm = (e: unknown) => String(e ?? '').trim().toLowerCase();

/**
 * Import one verifier result.
 *
 * Upserts on the address: a re-verification replaces the verdict rather than adding a
 * second, so "is this address deliverable" always has exactly one answer. The previous
 * verdict is not kept — a superseded one has no reader, and holding both would mean every
 * query choosing which to believe.
 */
export async function recordVerification(input: {
  email: string;
  status: string;
  subStatus?: string | null;
  leadId?: string | null;
  propertyId?: string | null;
  cohort?: string | null;
  personRole?: string | null;
  source?: string;
  batchLabel?: string | null;
  raw?: Record<string, unknown> | null;
}): Promise<void> {
  const email = norm(input.email);
  if (!email) return;
  const deliverable = isDeliverable(input.status);

  await sql`
    INSERT INTO "EmailVerification"
      ("id","email","leadId","propertyId","cohort","personRole","status","subStatus",
       "deliverable","source","batchLabel","verifiedAt","raw","createdAt","updatedAt")
    VALUES (${crypto.randomUUID()}, ${email}, ${input.leadId ?? null}, ${input.propertyId ?? null},
            ${input.cohort ?? null}, ${input.personRole ?? null},
            ${String(input.status ?? '').trim().toLowerCase()}, ${input.subStatus ?? null},
            ${deliverable}, ${input.source ?? 'zerobounce'}, ${input.batchLabel ?? null},
            NOW(), ${input.raw ? JSON.stringify(input.raw) : null}::jsonb, NOW(), NOW())
    ON CONFLICT (lower("email")) DO UPDATE
       SET "status"      = EXCLUDED."status",
           "subStatus"   = EXCLUDED."subStatus",
           "deliverable" = EXCLUDED."deliverable",
           "source"      = EXCLUDED."source",
           "batchLabel"  = EXCLUDED."batchLabel",
           "verifiedAt"  = NOW(),
           "raw"         = EXCLUDED."raw",
           -- Re-attached on every import: an address that moved to another lead should
           -- point at the lead it belongs to now, not the one it was first seen on.
           "leadId"      = COALESCE(EXCLUDED."leadId", "EmailVerification"."leadId"),
           "propertyId"  = COALESCE(EXCLUDED."propertyId", "EmailVerification"."propertyId"),
           "cohort"      = COALESCE(EXCLUDED."cohort", "EmailVerification"."cohort"),
           "updatedAt"   = NOW()`;
}

/** Every address with a verdict, as a lookup the ledger and the reports can share. */
export async function deliverableAddresses(): Promise<Set<string>> {
  const rows = await sql`
    SELECT "email" FROM "EmailVerification" WHERE "deliverable"` as Array<{ email: string }>;
  return new Set(rows.map((r) => norm(r.email)));
}

/** Every address checked, deliverable or not — so "unchecked" can be told from "failed". */
export async function verifiedAddresses(): Promise<Map<string, {
  status: string; deliverable: boolean; source: string; verifiedAt: string | null;
}>> {
  /**
   * `source` travels with the verdict.
   *
   * A verdict a producer typed and one ZeroBounce returned are the same two columns and
   * mean very different things — the cohort ledger counts both as verified. Any screen
   * showing a verdict has to be able to say which it is, so the lookup carries it rather
   * than every caller joining for it.
   */
  const rows = await sql`
    SELECT "email","status","deliverable","source","verifiedAt" FROM "EmailVerification"` as Array<Record<string, any>>;
  return new Map(rows.map((r) => [norm(r.email), {
    status: String(r.status),
    deliverable: Boolean(r.deliverable),
    source: String(r.source ?? 'zerobounce'),
    // timestamp without time zone — read the local parts, never toISOString().
    verifiedAt: r.verifiedAt instanceof Date
      ? `${r.verifiedAt.getFullYear()}-${String(r.verifiedAt.getMonth() + 1).padStart(2, '0')}-${String(r.verifiedAt.getDate()).padStart(2, '0')}`
      : null,
  }]));
}

/**
 * Where a cohort stands on verification.
 *
 * `unchecked` is its own number and not folded into `failed`. Before a run has happened
 * everything is unchecked, and an unchecked address reported as failed would show a cohort
 * losing its entire list to a verifier that has not run yet.
 */
export async function verificationSummary(params: { from?: string; to?: string } = {}): Promise<Array<{
  cohort: string; checked: number; deliverable: number; failed: number;
}>> {
  const rows = await sql`
    SELECT "cohort",
           COUNT(*)::int AS checked,
           COUNT(*) FILTER (WHERE "deliverable")::int AS deliverable,
           COUNT(*) FILTER (WHERE NOT "deliverable")::int AS failed
      FROM "EmailVerification"
     WHERE "cohort" IS NOT NULL
       AND (${params.from ?? null}::text IS NULL OR "cohort" >= ${params.from ?? null})
       AND (${params.to ?? null}::text   IS NULL OR "cohort" <= ${params.to ?? null})
     GROUP BY 1 ORDER BY 1` as Array<Record<string, any>>;
  return rows.map((r) => ({
    cohort: String(r.cohort),
    checked: Number(r.checked),
    deliverable: Number(r.deliverable),
    failed: Number(r.failed),
  }));
}

/** The failures, for the report that has to link back to the cards. */
export async function failedVerifications(params: {
  from?: string; to?: string; limit?: number;
} = {}): Promise<VerificationRow[]> {
  const rows = await sql`
    SELECT * FROM "EmailVerification"
     WHERE NOT "deliverable"
       AND (${params.from ?? null}::text IS NULL OR "cohort" >= ${params.from ?? null})
       AND (${params.to ?? null}::text   IS NULL OR "cohort" <= ${params.to ?? null})
     ORDER BY "cohort", "email"
     LIMIT ${Math.min(Number(params.limit) || 2000, 10000)}` as Array<Record<string, any>>;
  return rows.map((r) => ({
    email: String(r.email),
    leadId: r.leadId ?? null,
    propertyId: r.propertyId ?? null,
    cohort: r.cohort ?? null,
    personRole: r.personRole ?? null,
    status: String(r.status),
    subStatus: r.subStatus ?? null,
    deliverable: Boolean(r.deliverable),
    source: String(r.source),
    batchLabel: r.batchLabel ?? null,
    verifiedAt: wallClockIso(r.verifiedAt),
  }));
}
