import { NextRequest, NextResponse } from 'next/server';
import { runWeeklyPull } from '@/services/weeklyPull.service';
import { RENEWAL_PULL_LEAD_DAYS } from '@/services/pipeline.service';

/**
 * Weekly REAPI pull — Frank Jun-2026. SuperAdmin only (middleware-enforced).
 *
 *   GET  /api/admin/pull-weekly[?effDate=…|?date=…]   → DRY RUN, FREE
 *        Free ids_only scan; reports exact credit cost without spending anything.
 *
 *   POST /api/admin/pull-weekly[?effDate=…|?date=…]   → REAL PULL, SPENDS CREDITS
 *        Pulls full data for brand-new properties only, enriches them, and
 *        re-surfaces already-stored renewals for $0.
 *
 * Picking a specific week (both default to today):
 *   ?effDate=YYYY-MM-DD — the RENEWAL effective week you want to work. This is the
 *        producer-facing knob: the engine anchors on a run date and projects renewals
 *        +60 days, so we subtract the 60-day lead here (runDate = effDate − 60). Enter
 *        the effective date; the offset is handled for you.
 *   ?date=YYYY-MM-DD — raw run-date override (power users / reproducing a past run).
 *        If both are supplied, effDate wins.
 */

function parseRunDate(req: NextRequest): Date | undefined {
  const sp = req.nextUrl.searchParams;

  // Preferred: the producer enters the RENEWAL effective week. Renewals project
  // +RENEWAL_PULL_LEAD_DAYS from the run date, so runDate = effDate − lead days.
  const eff = sp.get('effDate');
  if (eff) {
    const d = new Date(eff);
    if (!isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() - RENEWAL_PULL_LEAD_DAYS);
      return d;
    }
  }

  // Raw run-date override (unchanged behaviour).
  const raw = sp.get('date');
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
