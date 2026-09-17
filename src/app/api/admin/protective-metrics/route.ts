import { NextRequest, NextResponse } from 'next/server';
import { computeMetrics, enforceMetrics, releasePause } from '@/services/protectiveMetrics.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

/**
 * Protective metrics — playbook §08.
 *
 *   GET  /api/admin/protective-metrics[?days=7][&campaignId=…]
 *        Read the four metrics. Computes nothing destructive, pauses nothing.
 *
 *   POST /api/admin/protective-metrics?campaignId=…[&days=7]
 *        Read AND enforce: any breach pauses the campaign at the vendor and is recorded.
 *        This is the call a daily schedule should make — §08 requires the enforcement to
 *        be the system's, not a person's.
 *
 *   PATCH /api/admin/protective-metrics  { pauseId, note }
 *        Release a pause. Separate and attributed, because §08 says restarting requires
 *        sign-off. Nothing else in this file can clear one.
 *
 * NOT YET SCHEDULED. Until POST runs on a timer (Vercel cron or equivalent), enforcement
 * is only as automatic as whoever remembers to call it — which is precisely the judgment
 * §08 is trying to remove.
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const days = Number(q.get('days'));
    const report = await computeMetrics({
      windowDays: Number.isFinite(days) && days > 0 ? days : undefined,
      campaignId: q.get('campaignId')?.trim() || undefined,
    });
    return NextResponse.json({ success: true, ...report });
  } catch (err: any) {
    console.error('GET /api/admin/protective-metrics error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not compute the protective metrics' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const campaignId = q.get('campaignId')?.trim();
    if (!campaignId) {
      return NextResponse.json(
        { success: false, error: 'campaignId is required — enforcement pauses a specific campaign.' },
        { status: 400 },
      );
    }
    const days = Number(q.get('days'));
    const result = await enforceMetrics({
      campaignId,
      windowDays: Number.isFinite(days) && days > 0 ? days : undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('POST /api/admin/protective-metrics error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not enforce the protective metrics' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pauseId = String(body?.pauseId ?? '').trim();
    if (!pauseId) {
      return NextResponse.json({ success: false, error: 'pauseId is required' }, { status: 400 });
    }
    // Attribution comes from the session, never the request body — a sign-off that can be
    // self-attributed is not a sign-off.
    const actor = actorLabel(await getSessionUser(req));
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const released = await releasePause(pauseId, actor, body?.note);
    return NextResponse.json(
      released
        ? { success: true, released: true, releasedBy: actor }
        : { success: false, error: 'No open pause with that id' },
      { status: released ? 200 : 404 },
    );
  } catch (err: any) {
    console.error('PATCH /api/admin/protective-metrics error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not release the pause' },
      { status: 500 },
    );
  }
}
