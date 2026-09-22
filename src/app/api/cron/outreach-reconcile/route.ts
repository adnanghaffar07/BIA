import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { reconcileOutreach, summarise } from '@/services/outreachReconcile.service';

/**
 * The fifteen-minute sweep that makes the sending platform agree with the CRM.
 *
 * Scheduled by vercel.json. Vercel Cron presents `Authorization: Bearer $CRON_SECRET`,
 * so this route cannot authenticate as a CRM user and sits on the middleware's
 * PUBLIC_PATHS list with its own shared-secret check instead — the same shape as the
 * campaign webhook, and for the same reason.
 *
 * ── ONCE A DAY, not every fifteen minutes ───────────────────────────────────
 * This was written as `*∕15 * * * *`. On Vercel's Hobby plan a cron that would run more
 * than once a day does not merely fail to fire — it FAILS THE DEPLOYMENT, with "Hobby
 * accounts are limited to daily cron jobs". Every deploy from the commit that added
 * vercel.json onward failed silently that way, Vercel carried on serving the last good
 * build, and the whole application sat frozen several commits behind while looking
 * healthy from the outside.
 *
 * So the schedule is daily, at 23:00 UTC (18:00/19:00 New York) — after the sending day,
 * and Hobby's precision is ±59 minutes in any case.
 *
 * ── What that means for the promise ─────────────────────────────────────────
 * The route was written to make the claim "converged within fifteen minutes, always".
 * On a daily schedule that claim is NOT true: a stop the platform rejected can leave a
 * recipient live for up to a day, and a bound customer can be mailed in that window.
 *
 * The honest position while this plan stands: the daily run is a backstop, and the real
 * guarantee around a send comes from running it deliberately —
 * /api/admin/outreach-reconcile (GET to inspect, POST to apply), or
 * scripts/reconcile-sweep.mjs. Anything that needs a tighter bound than a day needs a
 * plan that allows a tighter cron.
 */
export const maxDuration = 60;
// Vercel Cron issues a GET. Never cached: a cached sweep is no sweep.
export const dynamic = 'force-dynamic';

/**
 * Constant-time, never `===`: a plain compare short-circuits on the first differing byte
 * and leaks the secret to anyone who can measure response time.
 *
 * Fails CLOSED in production when unset. An unconfigured deploy must refuse rather than
 * expose an endpoint that deletes campaign recipients to anyone who finds the URL.
 */
function authorised(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[cron/reconcile] no CRON_SECRET configured — allowing through (dev only)');
    return true;
  }
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so length is checked first. Length is
  // not the secret; the bytes are.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorised' }, { status: 401 });
  }
  try {
    const result = await reconcileOutreach({ dryRun: false });
    const line = summarise(result);
    // Logged unconditionally: a sweep that found nothing is the evidence it ran at all,
    // and "no output for six hours" must not be indistinguishable from "cron is dead".
    console.log('[cron/reconcile]', line);
    if (result.stopped) console.error('[cron/reconcile] STOPPED —', result.stopped.detail);
    if (result.unknown) {
      console.warn(`[cron/reconcile] ${result.unknown} live recipient(s) unknown to the CRM — not touched`);
    }
    return NextResponse.json({ success: true, summary: line, ...result });
  } catch (err: any) {
    console.error('[cron/reconcile] failed:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Reconcile failed' },
      { status: 500 },
    );
  }
}
