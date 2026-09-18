import { NextRequest, NextResponse } from 'next/server';
import { getLeadsFromDb, getLeadByPropertyId } from '@/services/storage.service';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { traceAndApply, skipTraceBlocker, effectiveGrade } from '@/services/skipTraceApply.service';
import { isRunFatal, VendorError } from '@/services/vendorErrors';
import { insuredEmails } from '@/services/recipients.service';

/**
 * Deep Skip Trace Blast over an effective-date range (Frank Sep-2026).
 *
 *   GET  /api/admin/skiptrace-blast?effectiveDate=&effectiveTo=&grade=A[&…]
 *        FREE. What the blast would do: eligible count, what it skips and why,
 *        and the credit CEILING.
 *   POST same params [&chunk=25]
 *        Traces up to `chunk` leads and returns progress. Call again until
 *        done — see "Why chunks" below.
 *
 * Under /api/admin so middleware restricts it to admin + superadmin: one click
 * here can spend thousands of credits, which is not a producer-level action.
 *
 * ── Why chunks ────────────────────────────────────────────────────────────────
 * The existing /api/admin/skiptrace-batch traces its whole cohort inside one
 * request. Frank's pre-launch checklist (Tier 3) flags exactly what that costs:
 * a serverless timeout kills it mid-run with credits already spent and no
 * checkpoint, so nobody can tell which leads were charged. This route does one
 * bounded chunk per request and commits each lead as it goes.
 *
 * It needs no cursor to resume: a traced lead gets deepSkipTracedAt stamped and
 * therefore drops out of the eligible set, so "the next chunk" is always just
 * the first N still-eligible leads. Re-running after a crash, a closed laptop or
 * a Stop click picks up exactly where it left off and can never re-charge a lead
 * it already traced.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 * Tracerfy bills 15 credits for a hit and 0 for a miss, so the GET estimate is a
 * ceiling, not a charge. Actual spend comes back per chunk.
 */

/** Blast is Grade A only — Frank's request, and the guard against a mis-click over the book. */
const BLAST_GRADES = ['A'];
// Serverless budget: a Tracerfy lookup plus the courtesy gap runs ~600ms+, so 25
// leads exceeds every Vercel function limit. Five keeps a chunk near 4s. A timeout
// here is worse than elsewhere — credits are spent but the caller never learns which
// leads were charged.
export const maxDuration = 10;

const DEFAULT_CHUNK = 5;
const MAX_CHUNK = 10;
/** Courtesy gap between vendor calls, matching the existing batch route. */
const GAP_MS = 200;
const CREDITS_PER_HIT = 15;

/**
 * Rebuild the Leads page's filter set on the server.
 *
 * These are the same keys /api/leads takes, passed through to the same
 * getLeadsFromDb() call, so the blast population is exactly the population the
 * user is looking at — not a similar query that drifts from it.
 */
function parseFilters(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const str = (k: string) => { const v = q.get(k); return v && v.trim() ? v.trim() : undefined; };
  const engineRaw = str('engine');
  return {
    grade: str('grade'),
    status: str('status'),
    carrier: str('carrier'),
    propertyType: str('propertyType'),
    county: str('county'),
    zip: str('zip'),
    engine: engineRaw ? Number(engineRaw) : undefined,
    effectiveDate: str('effectiveDate'),
    effectiveTo: str('effectiveTo'),
    /**
     * Opt-in: trace ONLY leads we currently hold no insured address for.
     *
     * Off by default, so the blast behaves exactly as it always has. On, it is the
     * cheapest useful run there is — a lead that already has an address does not need
     * one bought for it, and at 15 credits a hit that difference is most of the budget.
     *
     * "Has an address" uses the same rule the campaign push and the reachability report
     * use, not a SQL "email1 is not null": the insured's addresses are attributed
     * per-person inside the trace payload, and the SQL predicate both misses email2 and
     * counts the CO-INSURED's address as if it were the insured's — which would skip a
     * lead we cannot actually mail.
     */
    onlyMissingEmail: q.get('onlyMissingEmail') === 'true',
  };
}

/** Refuse anything outside the feature's contract, with a reason worth showing. */
function validate(f: ReturnType<typeof parseFilters>): string | null {
  if (!f.effectiveDate || !f.effectiveTo) {
    return 'Set both a from and a to effective date before running a blast.';
  }
  if (f.effectiveDate > f.effectiveTo) {
    return 'The from date is after the to date.';
  }
  if (!f.grade || !BLAST_GRADES.includes(f.grade)) {
    return 'The blast runs on Grade A leads only. Set the Grade filter to A.';
  }
  return null;
}

type Triage = {
  candidates: any[];
  eligible: any[];
  alreadyTraced: number;
  missingName: number;
  wrongGrade: number;
  /** Skipped because we already hold an insured address — only when onlyMissingEmail. */
  alreadyReachable: number;
};

/** Split the filtered population into what we would trace and what we would skip. */
async function triage(f: ReturnType<typeof parseFilters>): Promise<Triage> {
  // No practical cap: the blast must see the whole matching set, not a page of it.
  const candidates = await getLeadsFromDb({ ...f, limit: 100000, orderBy: 'xdate' });
  const eligible: any[] = [];
  let alreadyTraced = 0, missingName = 0, wrongGrade = 0, alreadyReachable = 0;

  for (const lead of candidates) {
    if (!BLAST_GRADES.includes(effectiveGrade(lead))) { wrongGrade++; continue; }
    if (lead.deepSkipTracedAt) { alreadyTraced++; continue; }
    if (!String(lead.owner1FirstName ?? '').trim() || !String(lead.owner1LastName ?? '').trim()) {
      missingName++; continue;
    }
    if (f.onlyMissingEmail && insuredEmails(lead).length > 0) { alreadyReachable++; continue; }
    eligible.push(lead);
  }
  return { candidates, eligible, alreadyTraced, missingName, wrongGrade, alreadyReachable };
}

/** FREE — what the blast would do, so nobody spends credits to find out. */
export async function GET(req: NextRequest) {
  try {
    const f = parseFilters(req);
    const invalid = validate(f);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });

    const t = await triage(f);
    /**
     * No balance is quoted here any more.
     *
     * Tracerfy publishes no balance endpoint, so the only figure available was one
     * somebody had typed into AppConfig minus what had been spent since. The moment the
     * account was topped up outside the CRM that went stale, and it told people there
     * were zero credits while the vendor dashboard showed a balance — a warning that is
     * wrong in the alarming direction gets believed once and ignored ever after.
     *
     * The ceiling below is still worth saying, because it is arithmetic on THIS run and
     * cannot go stale. Whether the account can pay for it is answered by the run itself:
     * the vendor refuses, the blast stops on that call and reports it.
     */
    return NextResponse.json({
      success: true,
      range: { from: f.effectiveDate, to: f.effectiveTo },
      matching: t.candidates.length,
      eligible: t.eligible.length,
      onlyMissingEmail: f.onlyMissingEmail,
      skipped: {
        alreadyTraced: t.alreadyTraced,
        missingName: t.missingName,
        wrongGrade: t.wrongGrade,
        alreadyReachable: t.alreadyReachable,
      },
      // Ceiling, not a charge: a miss costs nothing, so real spend lands lower.
      maxCredits: t.eligible.length * CREDITS_PER_HIT,
    });
  } catch (err: any) {
    console.error('GET /api/admin/skiptrace-blast error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not preview the blast' },
      { status: 500 },
    );
  }
}

/** Trace one bounded chunk. The client calls this until `done`. */
export async function POST(req: NextRequest) {
  try {
    const f = parseFilters(req);
    const invalid = validate(f);
    if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });

    const chunkRaw = Number(req.nextUrl.searchParams.get('chunk') || DEFAULT_CHUNK);
    const chunk = Math.min(Math.max(Number.isFinite(chunkRaw) ? chunkRaw : DEFAULT_CHUNK, 1), MAX_CHUNK);
    const createdBy = actorLabel(await getSessionUser(req));

    // One id for the whole run, minted by the client and repeated on every chunk —
    // the server sees each chunk as a separate request, so it cannot mint one that
    // spans them. Falls back to a fresh id so a bare curl still records provenance.
    const runId = req.nextUrl.searchParams.get('runId')?.trim() || crypto.randomUUID();

    const t = await triage(f);
    const batch = t.eligible.slice(0, chunk);

    const results: Array<{
      propertyId: string; address: string; owner: string;
      matched: boolean; phone: boolean; email: boolean; coInsured: string | null;
      credits: number; error?: string;
    }> = [];
    let hit = 0, miss = 0, failed = 0, creditsSpent = 0;
    let recoveredPhone = 0, recoveredEmail = 0, coInsuredFound = 0;
    /** The vendor refused on account grounds — end the run, do not retry into it. */
    let stopped: { reason: 'no_credits' | 'auth'; vendor: string; detail: string } | null = null;

    for (const candidate of batch) {
      // Re-read immediately before tracing: another admin's blast, or the card
      // button, may have traced this lead since triage() listed it. This is what
      // stops two concurrent runs from both paying for the same lead.
      const lead = await getLeadByPropertyId(candidate.propertyId);
      const address = [lead?.addressStreet, lead?.addressCity].filter(Boolean).join(', ');
      const owner = [lead?.owner1FirstName, lead?.owner1LastName].filter(Boolean).join(' ');

      if (!lead) continue;
      const blocked = skipTraceBlocker(lead, { grades: BLAST_GRADES, skipIfTraced: true });
      if (blocked) continue;

      try {
        const out = await traceAndApply(lead, createdBy, { runId });
        if (out.matched) hit++; else miss++;
        creditsSpent += out.credits;
        if (out.recoveredPhone) recoveredPhone++;
        if (out.recoveredEmail) recoveredEmail++;
        if (out.coInsured) coInsuredFound++;
        results.push({
          propertyId: lead.propertyId, address, owner,
          matched: out.matched, phone: out.recoveredPhone, email: out.recoveredEmail,
          coInsured: out.coInsured, credits: out.credits,
        });
      } catch (err: any) {
        // One bad lead must not abandon the chunk — the rest are still worth tracing,
        // and a thrown vendor error has already cost nothing.
        failed++;
        const message = err?.message || 'Trace failed';
        results.push({
          propertyId: lead.propertyId, address, owner,
          matched: false, phone: false, email: false, coInsured: null, credits: 0,
          error: message,
        });

        /**
         * An account fault is not a bad lead — it is the end of the run.
         *
         * A failed trace leaves deepSkipTracedAt unstamped, so the lead stays eligible
         * and the next chunk picks it up again. With credits exhausted that is a spin:
         * `remaining` never falls, `done` never becomes true, and a driver looping until
         * done keeps calling the vendor for every lead in the cohort, forever. It
         * happened on this cohort — roughly 290 pointless calls after the balance hit
         * zero, none of them charged but none of them useful either.
         *
         * The vendor's own response decides this now. Matching "insufficient credits" in
         * a message string only caught the wording we had happened to see; a 402 whose
         * body reads "Payment required", or a rejected key, sailed straight past it.
         */
        if (isRunFatal(err)) {
          const e = err as VendorError;
          stopped = { reason: e.fault === 'auth' ? 'auth' : 'no_credits', vendor: e.vendor, detail: e.detail };
          break;
        }
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }

    const processed = hit + miss + failed;
    const remaining = Math.max(t.eligible.length - processed, 0);

    return NextResponse.json({
      success: true,
      runId,
      processed, hit, miss, failed, creditsSpent,
      recovered: { phone: recoveredPhone, email: recoveredEmail, coInsured: coInsuredFound },
      remaining,
      stopped: stopped ? { ...stopped, remaining } : null,
      // Kept for anything still reading the old flag.
      outOfCredits: stopped?.reason === 'no_credits',
      // Nothing left to trace, nothing traceable this round, or an account the vendor
      // will not serve — either way, stop. Without the last one a driver loops forever
      // against a set that can never shrink.
      done: remaining === 0 || processed === 0 || !!stopped,
      results,
    });
  } catch (err: any) {
    console.error('POST /api/admin/skiptrace-blast error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Blast failed' },
      { status: 500 },
    );
  }
}
