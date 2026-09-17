import { NextRequest, NextResponse } from 'next/server';
import { confirmCta } from '@/services/ctaResponse.service';

/**
 * POST /api/cta/confirm — the browser confirming a real person clicked.
 *
 * PUBLIC by necessity: a homeowner cannot authenticate. The security is that the caller
 * must already hold a responseId, which is minted server-side only after a validly signed
 * token was presented, and which can be confirmed exactly once.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 * The landing page could apply the disposition on GET. It must not. Email security
 * scanners and clients prefetch links, and a prefetch of "No thanks" would permanently
 * suppress a homeowner who never touched the email. Scanners fetch; they do not run
 * JavaScript. So the page renders on GET and this endpoint applies the effect.
 *
 * Deliberately no CSRF token: there is no session and no authority to borrow. A forged
 * request can only confirm an id the forger already possesses, which is the same thing
 * clicking the link does.
 */
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const responseId = String(body?.responseId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(responseId)) {
      return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
    }

    // Only the fields a CTA is allowed to supply. Anything else is ignored rather than
    // stored — this endpoint is open to the internet.
    const payload: Record<string, unknown> = {};
    if (typeof body?.renewalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.renewalDate)) {
      payload.renewalDate = body.renewalDate;
    }
    if (Number.isInteger(Number(body?.roofYear))) payload.roofYear = Number(body.roofYear);

    const result = await confirmCta(responseId, Object.keys(payload).length ? payload : null);

    // Already confirmed is a success from the visitor's point of view — they clicked, it
    // registered. Saying otherwise would invite them to click again.
    return NextResponse.json({ ok: true, applied: !!result, summary: result?.summary ?? null });
  } catch (err) {
    console.error('POST /api/cta/confirm error:', err);
    // Never leak internals to a public caller.
    return NextResponse.json({ ok: false, error: 'Could not record your response' }, { status: 500 });
  }
}
