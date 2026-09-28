import { NextRequest, NextResponse } from 'next/server';
import { getCohortLedger, LOST_TARGET_PCT } from '@/services/cohortLedger.service';
import { getGradeBLedger } from '@/services/gradeBLedger.service';

/**
 * GET /api/admin/cohort-ledger?effFrom=YYYY-MM-DD&effTo=YYYY-MM-DD
 *
 * ?grade=A (default) — one row per renewal week: Grade A at pull → downgraded → recovered
 * → Grade A now, with the loss percentage against the 5% target (register A43).
 *
 * ?grade=B — the Grade B funnel instead: in the roof band → queued → traced → has an
 * address → verified → mailable. A different set of columns on purpose; Grade B is not
 * being held at a grade, so retention has nothing to say about it.
 * Admin/superadmin only (enforced by middleware on /api/admin).
 */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    // Anything but 'B' means 'A', so a malformed value returns what this endpoint has
    // always returned rather than an empty table.
    const grade = p.get('grade') === 'B' ? 'B' : 'A';
    const range = {
      effFrom: p.get('effFrom') || undefined,
      effTo: p.get('effTo') || undefined,
    };
    const rows = grade === 'B'
      ? await getGradeBLedger(range)
      : await getCohortLedger(range);
    return NextResponse.json({
      success: true,
      grade,
      count: rows.length,
      // Only meaningful for Grade A — there is no retention target on a grade nobody is
      // trying to hold. Sent as null rather than 5 so the screen cannot draw it either way.
      targetPct: grade === 'A' ? LOST_TARGET_PCT : null,
      data: rows,
    });
  } catch (error) {
    console.error('GET /api/admin/cohort-ledger error:', error);
    return NextResponse.json({ success: false, error: 'Failed to build the cohort ledger' }, { status: 500 });
  }
}
