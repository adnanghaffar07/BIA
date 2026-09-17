import { NextRequest, NextResponse } from 'next/server';
import { backfillGradeHistory } from '@/services/gradeHistory.service';

/**
 * Rebuild the grade-change log and the starting-grade snapshot (register A8).
 *
 *   GET  /api/admin/grade-history   DRY RUN — what it would recover, writing nothing
 *   POST /api/admin/grade-history   rebuild for real
 *
 * Safe to re-run: each log entry is keyed to the activity it came from, and a lead's
 * starting grade is only ever written when it is still null. Nothing here can move a
 * baseline that has already been set — if it could, every cohort total measured against
 * it would change silently.
 */
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await backfillGradeHistory({ dryRun: true })) });
  } catch (err: any) {
    console.error('GET /api/admin/grade-history error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not preview the grade-history rebuild' },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest) {
  try {
    return NextResponse.json({ success: true, ...(await backfillGradeHistory({ dryRun: false })) });
  } catch (err: any) {
    console.error('POST /api/admin/grade-history error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not rebuild the grade history' },
      { status: 500 },
    );
  }
}
