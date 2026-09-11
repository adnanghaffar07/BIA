import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId } from '@/services/storage.service';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { traceAndApply, skipTraceBlocker } from '@/services/skipTraceApply.service';

/**
 * POST /api/leads/[id]/skip-trace
 *
 * Runs the deep (Tracerfy ENHANCED) skip trace for ONE lead — 15 credits on a
 * hit, 0 on a miss. Frank Aug-2026: Tracerfy replaced the REAPI skip trace,
 * whose data was corrupt, and the 5-credit standard tier was dropped so this is
 * now the only tier. Gated by skipTraceBlocker() at Grade A/B/C.
 *
 * The write itself lives in skipTraceApply.service.ts, shared with the Grade-A
 * blast on the Leads page, so the two cannot drift. Found phone/email fill EMPTY
 * contact slots only — producer-entered values are never overwritten.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // Re-runs are allowed here (Frank Sep-2026) — deliberately NOT passing skipIfTraced.
    // The one-run-per-lead block was removed after the middle-name bug: traces had been
    // failing for a reason that looked like "no data", producers wrote leads off on the
    // strength of it, and there was no way to check. A re-run costs 15 credits only if
    // Tracerfy answers — a miss is billed 0 — so verifying one lead is cheap. The blast
    // passes skipIfTraced because the same permissiveness at cohort scale is not.
    const blocked = skipTraceBlocker(lead, { grades: ['A', 'B', 'C'] });
    if (blocked) {
      return NextResponse.json({ success: false, error: blocked }, { status: 400 });
    }

    let payload: any = {};
    try { payload = await request.json(); } catch { /* body optional */ }
    const createdBy = actorLabel(await getSessionUser(request)) ?? payload?._createdBy ?? null;

    const result = await traceAndApply(lead, createdBy);

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({
      success: true,
      data: updated,
      result: { phones: result.phones, emails: result.emails, matched: result.matched },
    });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/skip-trace error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Skip trace failed' },
      { status: 500 },
    );
  }
}
