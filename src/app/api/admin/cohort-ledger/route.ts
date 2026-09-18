import { NextRequest, NextResponse } from 'next/server';
import { getCohortLedger, LOST_TARGET_PCT } from '@/services/cohortLedger.service';

/**
 * GET /api/admin/cohort-ledger?effFrom=YYYY-MM-DD&effTo=YYYY-MM-DD
 *
 * One row per renewal week: Grade A at pull → downgraded → recovered → Grade A now,
 * with the loss percentage against the 5% target (register A43).
 * Admin/superadmin only (enforced by middleware on /api/admin).
 */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const rows = await getCohortLedger({
      effFrom: p.get('effFrom') || undefined,
      effTo: p.get('effTo') || undefined,
    });
    return NextResponse.json({
      success: true,
      count: rows.length,
      targetPct: LOST_TARGET_PCT,
      data: rows,
    });
  } catch (error) {
    console.error('GET /api/admin/cohort-ledger error:', error);
    return NextResponse.json({ success: false, error: 'Failed to build the cohort ledger' }, { status: 500 });
  }
}
