import { NextRequest, NextResponse } from 'next/server';
import { assignHoldout, HOLDOUT_PERCENT } from '@/services/holdout.service';

/**
 * The 10% holdout (playbook §00).
 *
 *   GET  /api/admin/holdout[?cohort=YYYY-MM-DD]   DRY RUN — the split, writing nothing
 *   POST /api/admin/holdout[?cohort=YYYY-MM-DD]   assign for real
 *
 * Under /api/admin so middleware restricts it to admin + superadmin. Assigning the control
 * group is a decision about the experiment, not a producer action.
 *
 * Safe to re-run: a lead that already carries holdoutAssignedAt is never touched again, so
 * a second run can only pick up leads that have arrived since. Nothing here can move a
 * lead between groups — if it could, every result measured against the control would be
 * quietly meaningless.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const cohort = req.nextUrl.searchParams.get('cohort')?.trim() || undefined;
    const result = await assignHoldout({ cohort, dryRun: true });
    return NextResponse.json({ success: true, holdoutPercent: HOLDOUT_PERCENT, ...result });
  } catch (err: any) {
    console.error('GET /api/admin/holdout error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not preview the holdout split' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const cohort = req.nextUrl.searchParams.get('cohort')?.trim() || undefined;
    const result = await assignHoldout({ cohort, dryRun: false });
    return NextResponse.json({ success: true, holdoutPercent: HOLDOUT_PERCENT, ...result });
  } catch (err: any) {
    console.error('POST /api/admin/holdout error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not assign the holdout' },
      { status: 500 },
    );
  }
}
