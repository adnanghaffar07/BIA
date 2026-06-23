import { NextRequest, NextResponse } from 'next/server';
import { runWeeklyPull } from '@/services/weeklyPull.service';

/**
 * Weekly REAPI pull — Frank Jun-2026. SuperAdmin only (middleware-enforced).
 *
 *   GET  /api/admin/pull-weekly[?date=YYYY-MM-DD]   → DRY RUN, FREE
 *        Free ids_only scan; reports exact credit cost without spending anything.
 *
 *   POST /api/admin/pull-weekly[?date=YYYY-MM-DD]   → REAL PULL, SPENDS CREDITS
 *        Pulls full data for brand-new properties only, enriches them, and
 *        re-surfaces already-stored renewals for $0.
 *
 *   ?date=YYYY-MM-DD overrides the run date (defaults to today) so a specific
 *   week can be reproduced.
 */

function parseRunDate(req: NextRequest): Date | undefined {
  const raw = req.nextUrl.searchParams.get('date');
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  try {
    const result = await runWeeklyPull({ runDate: parseRunDate(req), dryRun: true });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Weekly pull dry-run failed' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await runWeeklyPull({ runDate: parseRunDate(req), dryRun: false });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Weekly pull failed' },
      { status: 500 },
    );
  }
}
