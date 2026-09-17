import { verifyCtaToken, CTAS, isCtaKey, type CtaKey } from '@/lib/ctaToken';
import { pool } from '@/lib/neon';
import { recordCtaArrival } from '@/services/ctaResponse.service';
import { headers } from 'next/headers';
import CtaConfirm from './CtaConfirm';

/**
 * The §05 landing page — public, unauthenticated, reached from an email button.
 *
 * ── What it deliberately does NOT show ──────────────────────────────────────
 * No address, no owner name, no lead id. A link token is a bearer credential that lives in
 * someone's inbox for months and survives being forwarded, so the page shows the one thing
 * the email already told them — their indicative band — and nothing that would turn a
 * leaked link into a disclosure about a named person at a known address.
 *
 * ── Why rendering does not apply the disposition ────────────────────────────
 * Email scanners prefetch links. The arrival is recorded here; the effect is applied by
 * CtaConfirm from the browser, which a scanner does not run.
 */

export const dynamic = 'force-dynamic';

const shell = (title: string, body: React.ReactNode) => (
  <main style={{
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    maxWidth: 560, margin: '0 auto', padding: '48px 20px', color: '#1f2733', lineHeight: 1.55,
  }}>
    <div style={{ fontWeight: 700, fontSize: 18, color: '#1565c0', marginBottom: 28 }}>
      Burlington Insurance Agency
    </div>
    <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>{title}</h1>
    {body}
  </main>
);

export default async function CtaLandingPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const action = Array.isArray(sp.a) ? sp.a[0] : sp.a;

  const verified = verifyCtaToken(token);
  // One neutral message for every failure. Distinguishing "expired" from "bad signature"
  // tells someone probing which of the two they achieved.
  if (!verified.ok || !isCtaKey(action)) {
    return shell('This link is no longer valid', (
      <p style={{ color: '#5c6b78' }}>
        It may have expired. If you were expecting to hear from us, reply to the email you
        received and we will pick it up from there.
      </p>
    ));
  }

  const cta = action as CtaKey;
  const spec = CTAS[cta];

  const { rows } = await pool.query(
    `SELECT "id", "indicativeBandLow", "indicativeBandHigh", "publishedBandLow", "publishedBandHigh"
       FROM "Lead" WHERE "id" = $1`,
    [verified.payload.l],
  );
  if (!rows.length) {
    return shell('This link is no longer valid', (
      <p style={{ color: '#5c6b78' }}>
        If you were expecting to hear from us, reply to the email you received.
      </p>
    ));
  }
  const lead = rows[0];

  const h = await headers();
  const responseId = await recordCtaArrival({
    leadId: lead.id,
    cta,
    campaignId: verified.payload.c ?? null,
    step: verified.payload.s ?? null,
    userAgent: h.get('user-agent'),
    // Behind a proxy the client address is the first hop in the forwarded chain.
    ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
  });

  // The band as PUBLISHED wins: that is the figure the homeowner was actually shown, and
  // re-running a valuation must not change the number under them mid-conversation.
  const low = lead.publishedBandLow ?? lead.indicativeBandLow;
  const high = lead.publishedBandHigh ?? lead.indicativeBandHigh;
  const money = (v: unknown) => (v == null ? null : `$${Math.round(Number(v)).toLocaleString()}`);

  return shell(spec.label, (
    <>
      <CtaConfirm responseId={responseId} cta={cta} />

      {/* §05: "Show the band immediately. They clicked to see a number. Withholding it to
          force a phone call is precisely the behavior that makes people hate insurance
          marketing." Shown for every CTA except the two that are a refusal. */}
      {low && high && cta !== 'no_thanks' && cta !== 'not_mine' && (
        <div style={{
          margin: '20px 0', padding: 18, borderRadius: 10,
          border: '1px solid #cfe0f5', background: '#f4f9ff',
        }}>
          <div style={{ fontSize: 13, color: '#5c6b78', marginBottom: 4 }}>
            Your indicative annual premium
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#1565c0' }}>
            {money(low)} – {money(high)}
          </div>
          <div style={{ fontSize: 12.5, color: '#5c6b78', marginTop: 8 }}>
            This is an indicative range based on public property data, not a quote. The final
            premium depends on underwriting and the details we confirm with you.
          </div>
        </div>
      )}

      {/* §05: "Put a scheduling link on the email and page. Probably the single
          highest-leverage addition in this document." The URL is configuration, not code —
          when it is unset the block is omitted rather than rendering a dead button. */}
      {process.env.NEXT_PUBLIC_SCHEDULING_URL && cta !== 'no_thanks' && cta !== 'not_mine' && (
        <p style={{ margin: '22px 0' }}>
          <a
            href={process.env.NEXT_PUBLIC_SCHEDULING_URL}
            style={{
              display: 'inline-block', padding: '11px 18px', borderRadius: 8,
              background: '#1565c0', color: '#fff', textDecoration: 'none', fontWeight: 600,
            }}
          >
            Pick a time that suits you
          </a>
        </p>
      )}

      <p style={{ fontSize: 13, color: '#5c6b78', marginTop: 28 }}>
        Burlington Insurance Agency · New Jersey
      </p>
    </>
  ));
}
