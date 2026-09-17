import crypto from 'crypto';

/**
 * Signed, opaque links for the §05 CTA buttons.
 *
 * Playbook §05, landing-page non-negotiables: "Signed opaque tokens in URLs, never
 * sequential lead IDs. A page rendering property or premium data behind an enumerable ID
 * is a consumer-data exposure."
 *
 * ── What this is and is not ─────────────────────────────────────────────────
 * It is a SIGNED token: nobody can forge one, and nobody can change the lead id inside a
 * real one without invalidating it. It is not encrypted — the payload is readable by
 * anyone holding the link, which is why it carries an opaque lead id and nothing else. No
 * address, no name, no premium.
 *
 * It is a BEARER credential. Whoever holds the link is treated as the recipient, because a
 * homeowner clicking from their phone cannot be asked to authenticate. A forwarded email
 * forwards the token. That is an accepted and unavoidable property of one-click email
 * CTAs; it is bounded by keeping the payload thin and the lifetime finite.
 */

/**
 * Its own secret, not the session secret.
 *
 * These tokens live in other people's inboxes for months. Sharing a secret with session
 * signing would mean rotating one forces the other, and a leak of either compromises both.
 * Falls back in development only, and loudly — production must configure it.
 */
function secret(): string {
  const s = process.env.CTA_TOKEN_SECRET;
  if (s && s.trim()) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CTA_TOKEN_SECRET is not configured — refusing to sign CTA links.');
  }
  console.warn('[ctaToken] CTA_TOKEN_SECRET unset — using a development fallback');
  return 'bia-cta-dev-secret-not-for-production';
}

/**
 * Long enough to outlive the sequence, short enough to expire.
 *
 * The 21-day cadence runs E1 to E4 over roughly six weeks, and a homeowner may open an old
 * email well after it lands. 120 days covers that with room; beyond it the link is dead and
 * the person can be contacted the normal way.
 */
const MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

export type CtaTokenPayload = {
  /** Lead id — opaque, non-sequential. */
  l: string;
  /** Campaign id, so a response can be attributed to the send that caused it. */
  c?: string;
  /** Email step (1..4). */
  s?: number;
  /** Issued-at, epoch seconds. */
  t: number;
};

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function sign(body: string): string {
  return b64url(crypto.createHmac('sha256', secret()).update(body).digest());
}

/** Mint a link token for one lead and one send. */
export function signCtaToken(input: { leadId: string; campaignId?: string | null; step?: number | null }): string {
  const payload: CtaTokenPayload = {
    l: input.leadId,
    ...(input.campaignId ? { c: input.campaignId } : {}),
    ...(input.step ? { s: input.step } : {}),
    t: Math.floor(Date.now() / 1000),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; payload: CtaTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

/**
 * Verify and decode. Returns a reason, never throws.
 *
 * The caller must NOT show the reason to the visitor — a page that distinguishes "bad
 * signature" from "expired" tells someone probing which of the two they achieved. One
 * neutral message for every failure.
 */
export function verifyCtaToken(token: string): VerifyResult {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;

  const expected = sign(body);
  // Constant-time: a plain === leaks the signature one byte at a time to anyone who can
  // measure response time.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

  let payload: CtaTokenPayload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload?.l || typeof payload.t !== 'number') return { ok: false, reason: 'malformed' };
  if (Date.now() - payload.t * 1000 > MAX_AGE_MS) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}

/** The six buttons, exactly as specified in §05. */
export const CTAS = {
  quote:     { label: 'Yes — send me a quote',                  disposition: 'HOT',         slaMinutes: 15 },
  savings:   { label: 'What would I save?',                     disposition: 'WARM',        slaMinutes: 240 },
  defer:     { label: 'Not now — check back before my renewal', disposition: 'DEFERRED',    slaMinutes: null },
  roof:      { label: 'My roof was replaced in the last 10 years', disposition: 'PROMOTE',  slaMinutes: null },
  no_thanks: { label: 'No thanks',                              disposition: 'SUPPRESSED',  slaMinutes: null },
  not_mine:  { label: 'This is not my property',                disposition: 'BAD_CONTACT', slaMinutes: null },
} as const;

export type CtaKey = keyof typeof CTAS;

export const isCtaKey = (v: unknown): v is CtaKey =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(CTAS, v);

/** The link that goes in an email. */
export function ctaUrl(baseUrl: string, token: string, cta: CtaKey): string {
  return `${baseUrl.replace(/\/+$/, '')}/c/${token}?a=${cta}`;
}
