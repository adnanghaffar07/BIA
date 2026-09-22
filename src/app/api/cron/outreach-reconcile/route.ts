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
 * ── Why this is what we promise Frank, rather than "instantly" ──────────────
 * Removal from the vendor's campaign is the only mechanism that provably halts sends,
 * and it is a network call that can fail. stopHousehold() does it inline and reports a
 * failure; without this sweep that report is the end of the story and the recipient keeps
 * receiving mail. With it, the guarantee is "converged within fifteen minutes, always"
 * — weaker sounding than "immediately", and true.
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
