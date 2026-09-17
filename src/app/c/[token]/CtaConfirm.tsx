'use client';

import { useEffect, useState } from 'react';
import { CTAS, type CtaKey } from '@/lib/ctaToken';

/**
 * Confirms, from the browser, that a person and not a scanner opened this link.
 *
 * Email security appliances and clients prefetch every URL in a message. If the landing
 * page applied the disposition on render, a prefetch of "No thanks" would permanently
 * suppress a homeowner who never touched the email — and we would have no way of knowing.
 * Scanners fetch pages; they do not execute JavaScript.
 *
 * The extra step is invisible to a real visitor: the confirm fires on mount and the
 * acknowledgement appears in the same moment the page does. The only people who ever see
 * the manual button are those with JavaScript disabled, who would otherwise be silently
 * unable to respond at all.
 */
export default function CtaConfirm({ responseId, cta }: { responseId: string; cta: CtaKey }) {
  const [state, setState] = useState<'sending' | 'done' | 'failed'>('sending');
  // The two CTAs that carry an answer rather than just an intent.
  const [renewalDate, setRenewalDate] = useState('');
  const [roofYear, setRoofYear] = useState('');

  const send = async (extra?: Record<string, unknown>) => {
    setState('sending');
    try {
      const res = await fetch('/api/cta/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responseId, ...extra }),
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  useEffect(() => {
    // Fire once on mount. Confirming twice is harmless — the server claims the row and
    // ignores the second — but there is no reason to ask.
    send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responseId]);

  const spec = CTAS[cta];

  const ack = () => {
    switch (cta) {
      case 'quote':     return 'Thanks — we have it. Ruben will call you shortly.';
      case 'savings':   return 'Thanks — your indicative range is below, and we will follow up with the detail.';
      case 'defer':     return 'Understood — we will get back in touch closer to your renewal.';
      case 'roof':      return 'Thank you, that helps. A newer roof usually improves the rate we can find.';
      case 'no_thanks': return 'Done — we have stopped emailing you about this property.';
      case 'not_mine':  return 'Thank you for telling us. We have stopped emailing you about this property.';
    }
  };

  return (
    <div>
      {state === 'failed' ? (
        <div style={{ padding: 14, borderRadius: 8, background: '#fff7f7', border: '1px solid #f2a3a3' }}>
          <p style={{ margin: '0 0 10px' }}>We could not record that automatically.</p>
          <button
            onClick={() => send()}
            style={{
              padding: '10px 16px', borderRadius: 8, border: 'none',
              background: '#1565c0', color: '#fff', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {spec.label}
          </button>
        </div>
      ) : (
        <p style={{ margin: '0 0 8px', color: state === 'done' ? '#166534' : '#5c6b78' }}>
          {state === 'done' ? ack() : 'One moment…'}
        </p>
      )}

      {/* "Not now" is only useful if it captures WHEN. Optional: a date we do not get still
          leaves the lead flagged for revisit. */}
      {state === 'done' && cta === 'defer' && (
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 13, color: '#5c6b78', display: 'block', marginBottom: 6 }}>
            When does your policy renew? (optional)
          </label>
          <input
            type="date" value={renewalDate}
            onChange={(e) => setRenewalDate(e.target.value)}
            style={{ padding: 9, borderRadius: 7, border: '1px solid #cfd6e0', fontSize: 15 }}
          />
          <button
            onClick={() => send({ renewalDate })}
            disabled={!renewalDate}
            style={{
              marginLeft: 8, padding: '9px 15px', borderRadius: 7, border: 'none',
              background: renewalDate ? '#1565c0' : '#c8d0da', color: '#fff', fontWeight: 600,
              cursor: renewalDate ? 'pointer' : 'default',
            }}
          >
            Save
          </button>
        </div>
      )}

      {/* Roof year gates the entire Grade B pool, so it is worth one optional question —
          but the claim is already recorded whether or not they answer it. */}
      {state === 'done' && cta === 'roof' && (
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 13, color: '#5c6b78', display: 'block', marginBottom: 6 }}>
            Which year was it replaced? (optional)
          </label>
          <input
            type="number" inputMode="numeric" placeholder="e.g. 2019"
            min={new Date().getFullYear() - 15} max={new Date().getFullYear()}
            value={roofYear} onChange={(e) => setRoofYear(e.target.value)}
            style={{ padding: 9, borderRadius: 7, border: '1px solid #cfd6e0', fontSize: 15, width: 130 }}
          />
          <button
            onClick={() => send({ roofYear: Number(roofYear) })}
            disabled={!roofYear}
            style={{
              marginLeft: 8, padding: '9px 15px', borderRadius: 7, border: 'none',
              background: roofYear ? '#1565c0' : '#c8d0da', color: '#fff', fontWeight: 600,
              cursor: roofYear ? 'pointer' : 'default',
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
