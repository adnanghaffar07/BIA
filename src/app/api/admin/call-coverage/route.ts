import { NextRequest, NextResponse } from 'next/server';
import { callCoverage } from '@/services/callCoverage.service';

/**
 * GET /api/admin/call-coverage?cohorts=2026-10-05&grade=A
 *
 * Numbers held against numbers worked, per card. Read-only.
 *
 * Deliberately not cached. It is read while the calling is happening — Ruben to see what is
 * left on a card, Frank to see whether the cohort is being worked — and a figure that is ten
 * minutes stale is one that disagrees with the phone in somebody's hand.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const cohorts = (request.nextUrl.searchParams.get('cohorts') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const grade = request.nextUrl.searchParams.get('grade') ?? '';
    const data = await callCoverage({ cohorts, grade: grade || undefined });
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('GET /api/admin/call-coverage error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not read coverage' },
      { status: 500 },
    );
  }
}
