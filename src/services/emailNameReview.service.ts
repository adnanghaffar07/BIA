import { sql } from '@/lib/neon';
import { wallClockIso } from '@/lib/wallClock';
import { checkEmailAgainstNames } from './emailNameMatch.service';
import { bestInsuredAddress, bestCoInsuredAddress } from './addressRank.service';

/**
 * The surname review list (Frank, 24 Sep 2026 · second email §7).
 *
 * "A surname match between every skip-trace-recovered address and the insured or
 *  co-insured. Failures go to a review list, not into a send."
 *
 * ── Why this cannot be left to email verification ───────────────────────────
 * Frank, in the same paragraph: "Email verification will not catch this. It confirms a
 * mailbox exists, not that it belongs to the person. It will pass this address and the send
 * will still be wrong."
 *
 * The account that prompted it has insured Claudia Garcia, co-insured Cesar Garcia, and one
 * address: dburnette19@gmail.com. A verifier says that mailbox is live, and it is — it
 * belongs to somebody else. Sending there discloses a stranger's property details and
 * estimated premium, from a domain with no sending history to absorb the complaint.
 *
 * ── Only the address that would actually be MAILED is checked ───────────────
 * A lead can carry a dozen candidate addresses; the push sends to the top-ranked one per
 * person. Checking all of them would put addresses nobody was going to use into a queue
 * somebody has to work through — 2,106 candidates against 1,278 real sends on the wave-one
 * list — and a review queue that is mostly noise is a review queue nobody finishes.
 *
 * ── Held by default, released deliberately ──────────────────────────────────
 * An undecided row keeps its address out of every send. Approving is an act by a named
 * person. The failure this guards against is silent release, so absence of a decision means
 * hold rather than proceed.
 */

export type ReviewDecision = 'approved' | 'rejected';

export type ReviewRow = {
  id: string;
  leadId: string;
  propertyId: string | null;
  cohort: string | null;
  personRole: 'insured' | 'coInsured';
  email: string;
  verdict: string;
  checkedAt: string | null;
  decision: ReviewDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  owner: string | null;
  address: string | null;
};

const norm = (e: unknown) => String(e ?? '').trim().toLowerCase();

/**
 * Every address the trace payload carries, so a producer-typed address is not treated as
 * recovered.
 *
 * Frank's rule is about skip-trace-recovered addresses specifically. An address somebody at
 * the agency typed onto the card carries a different kind of evidence, and holding it would
 * be second-guessing a person who had the account in front of them.
 *
 * On the wave-one list this barely narrows anything — 1,250 of the 1,278 addresses that
 * would be mailed came from a trace — but the distinction is the instruction, and the 28
 * that did not should not be in a queue about trace quality.
 */
function tracedAddresses(lead: Record<string, any>): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (!v) return;
    if (typeof v === 'string') { if (v.includes('@')) out.add(norm(v)); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(walk); }
  };
  walk(lead.skipTraceData);
  return out;
}

export type BuildResult = {
  checked: number;
  matched: number;
  queued: number;
  alreadyQueued: number;
  /** Addresses skipped because a producer typed them rather than a trace finding them. */
  notTraced: number;
  byCohort: Array<{ cohort: string; n: number }>;
};

/**
 * Check the wave-one send list and queue every failure.
 *
 * Idempotent: a decision already made survives, because the unique index makes a re-run an
 * ON CONFLICT DO NOTHING. Re-running after a fresh trace picks up new addresses and leaves
 * settled ones alone.
 */
export async function buildReviewQueue(params: {
  effFrom: string; effTo: string; dryRun?: boolean;
}): Promise<BuildResult> {
  const { effFrom, effTo, dryRun = true } = params;

  const leads = await sql`
    SELECT * FROM "Lead"
     WHERE "sendListBuiltAt" IS NOT NULL
       AND "cohort" BETWEEN ${effFrom} AND ${effTo}
     ORDER BY "cohort"` as Array<Record<string, any>>;

  const out: BuildResult = {
    checked: 0, matched: 0, queued: 0, alreadyQueued: 0, notTraced: 0, byCohort: [],
  };
  const perCohort = new Map<string, number>();

  for (const l of leads) {
    const people = [
      { first: l.owner1FirstName, last: l.owner1LastName, role: 'insured' as const },
      { first: l.owner2FirstName, last: l.owner2LastName, role: 'coInsured' as const },
    ].filter((p) => p.first || p.last);
    if (!people.length) continue;

    const traced = tracedAddresses(l);

    for (const [role, picked] of [
      ['insured', bestInsuredAddress(l)],
      ['coInsured', bestCoInsuredAddress(l)],
    ] as Array<['insured' | 'coInsured', { email?: string } | null]>) {
      const email = norm(picked?.email);
      if (!email) continue;

      if (!traced.has(email)) { out.notTraced++; continue; }

      out.checked++;
      const raw = checkEmailAgainstNames(email, people);
      const verdict = typeof raw === 'string' ? raw : (raw as { verdict: string }).verdict;
      if (verdict === 'match') { out.matched++; continue; }

      perCohort.set(String(l.cohort), (perCohort.get(String(l.cohort)) ?? 0) + 1);
      if (dryRun) { out.queued++; continue; }

      const rows = await sql`
        INSERT INTO "EmailNameReview"
          ("id","leadId","propertyId","cohort","personRole","email","verdict","checkedAt",
           "createdAt","updatedAt")
        VALUES (${crypto.randomUUID()}, ${String(l.id)}, ${l.propertyId ?? null},
                ${l.cohort ?? null}, ${role}, ${email}, ${verdict}, NOW(), NOW(), NOW())
        ON CONFLICT ("leadId","personRole","email") DO NOTHING
        RETURNING "id"` as Array<{ id: string }>;
      if (rows.length) out.queued++; else out.alreadyQueued++;
    }
  }

  out.byCohort = [...perCohort].sort().map(([cohort, n]) => ({ cohort, n }));
  return out;
}

/**
 * Addresses currently held out of sending.
 *
 * Returned as a Set of lower-cased addresses so the push can test membership per candidate
 * without a query per address.
 */
export async function heldAddresses(): Promise<Set<string>> {
  const rows = await sql`
    SELECT DISTINCT "email" FROM "EmailNameReview" WHERE "decision" IS NULL
       OR "decision" = 'rejected'` as Array<{ email: string }>;
  return new Set(rows.map((r) => norm(r.email)));
}

export async function getReviewList(params: {
  cohortFrom?: string; cohortTo?: string; openOnly?: boolean; limit?: number;
} = {}): Promise<ReviewRow[]> {
  const rows = await sql`
    SELECT r.*, l."owner1FirstName", l."owner1LastName", l."addressStreet", l."addressCity"
      FROM "EmailNameReview" r
      LEFT JOIN "Lead" l ON l."id" = r."leadId"
     WHERE (${params.cohortFrom ?? null}::text IS NULL OR r."cohort" >= ${params.cohortFrom ?? null})
       AND (${params.cohortTo ?? null}::text   IS NULL OR r."cohort" <= ${params.cohortTo ?? null})
       AND (${params.openOnly ?? false}::boolean = FALSE OR r."decision" IS NULL)
     -- Mismatch first: "this belongs to a different name" is a decision somebody can
     -- actually make, where "we cannot tell" mostly is not.
     ORDER BY CASE r."verdict" WHEN 'mismatch' THEN 0 ELSE 1 END, r."cohort", r."email"
     LIMIT ${Math.min(Number(params.limit) || 1000, 5000)}` as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    leadId: String(r.leadId),
    propertyId: r.propertyId ?? null,
    cohort: r.cohort ?? null,
    personRole: r.personRole as 'insured' | 'coInsured',
    email: String(r.email),
    verdict: String(r.verdict),
    checkedAt: wallClockIso(r.checkedAt),
    decision: (r.decision ?? null) as ReviewDecision | null,
    decidedBy: r.decidedBy ?? null,
    decidedAt: wallClockIso(r.decidedAt),
    note: r.note ?? null,
    owner: [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ') || null,
    address: [r.addressStreet, r.addressCity].filter(Boolean).join(', ') || null,
  }));
}

/** Record a person's decision on held addresses. */
export async function decideReview(ids: string[], input: {
  decision: ReviewDecision; decidedBy: string; note?: string | null;
}): Promise<number> {
  if (!ids.length) return 0;
  const rows = await sql`
    UPDATE "EmailNameReview"
       SET "decision" = ${input.decision}, "decidedBy" = ${input.decidedBy},
           "decidedAt" = NOW(), "note" = ${input.note ?? null}, "updatedAt" = NOW()
     WHERE "id" = ANY(${ids}::text[]) AND "decision" IS NULL
    RETURNING "id"` as Array<{ id: string }>;
  return rows.length;
}

/** Counts for the preflight and the tab. */
export async function reviewSummary(): Promise<{
  open: number; approved: number; rejected: number; byCohort: Array<{ cohort: string; open: number }>;
}> {
  const [t] = await sql`
    SELECT COUNT(*) FILTER (WHERE "decision" IS NULL)::int AS open,
           COUNT(*) FILTER (WHERE "decision" = 'approved')::int AS approved,
           COUNT(*) FILTER (WHERE "decision" = 'rejected')::int AS rejected
      FROM "EmailNameReview"` as Array<Record<string, any>>;
  const byCohort = await sql`
    SELECT "cohort", COUNT(*)::int AS open FROM "EmailNameReview"
     WHERE "decision" IS NULL AND "cohort" IS NOT NULL
     GROUP BY 1 ORDER BY 1` as Array<Record<string, any>>;
  return {
    open: Number(t?.open ?? 0),
    approved: Number(t?.approved ?? 0),
    rejected: Number(t?.rejected ?? 0),
    byCohort: byCohort.map((r) => ({ cohort: String(r.cohort), open: Number(r.open) })),
  };
}
