import crypto from 'crypto';

/**
 * Inbound campaign-webhook verification and payload normalisation.
 *
 * The vendor does not sign its webhook payloads — there is no HMAC scheme to verify
 * against — so authentication is a shared static secret configured by hand in the
 * vendor's dashboard and sent back on every request as a custom header.
 */

export const WEBHOOK_HEADER = 'x-bia-campaign-key';

/**
 * Constant-time comparison, never `===`: a plain string compare short-circuits on the
 * first differing byte and leaks the secret one character at a time to anyone who can
 * measure response time.
 *
 * Fails CLOSED in production when the secret is unset — an unconfigured deploy must
 * refuse traffic rather than accept anything that arrives. Fails open only in local
 * dev, loudly, so testing is not blocked by a missing env var.
 */
export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.LEADS_CAMPAIGN_WEBHOOK_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false;
    console.warn('[campaign-webhook] no secret configured — allowing through (dev only)');
    return true;
  }
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so the length check has to come first.
  // Length is not secret; the bytes are.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type OutcomeKind = 'reply' | 'bounce' | 'open' | 'click' | 'unsubscribe' | 'complaint' | 'sent' | null;

/**
 * Classify the event.
 *
 * Substring matching, not an exact enum: vendors label these inconsistently between
 * their docs, their dashboard and the payloads they actually send (`reply_received`,
 * `email_replied`, `lead_replied` all mean the same thing). An exact match silently
 * drops events when the vendor renames one, and a dropped reply means we keep mailing
 * somebody who already answered.
 */
export function classifyEvent(eventType: string | null | undefined): OutcomeKind {
  const e = String(eventType ?? '').toLowerCase();
  if (!e) return null;
  if (e.includes('unsubscrib')) return 'unsubscribe';   // before "sent"/"sub" confusion
  if (e.includes('complain') || e.includes('spam')) return 'complaint';
  if (e.includes('repl')) return 'reply';
  if (e.includes('bounc')) return 'bounce';
  if (e.includes('click')) return 'click';
  if (e.includes('open')) return 'open';
  if (e.includes('sent') || e.includes('deliver')) return 'sent';
  return null;
}

/** Vendors differ on where the useful fields sit; read several shapes. */
export function readPayload(body: any) {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = k.split('.').reduce<any>((o, part) => (o == null ? o : o[part]), body);
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  };
  const stepRaw = pick('step', 'email_step', 'sequence_step', 'lead.step');
  const step = stepRaw != null && /^\d+$/.test(stepRaw) ? Number(stepRaw) : null;
  return {
    eventType: pick('event_type', 'eventType', 'type', 'event'),
    email: (pick('lead_email', 'email', 'lead.email', 'to_address_email_list') ?? '').toLowerCase() || null,
    campaignId: pick('campaign_id', 'campaignId', 'campaign.id', 'campaign'),
    vendorLeadId: pick('lead_id', 'leadId', 'lead.id'),
    step,
    replyText: pick('reply_text', 'reply_text_snippet', 'body.text', 'text', 'message', 'reply_html'),
    bounceReason: pick('bounce_reason', 'reason', 'error', 'detail'),
    bounceType: pick('bounce_type', 'bounceType'),
  };
}

/**
 * Strip quoted history and signature blocks so the stored excerpt is what the person
 * actually wrote, not their reply plus our own email underneath it.
 */
export function cleanReplyExcerpt(raw: string | null, max = 500): string | null {
  if (!raw) return null;
  let text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const cutMarkers = [
    /^\s*On .+ wrote:\s*$/im,        // Gmail / Apple Mail
    /^\s*-{2,}\s*Original Message/im,
    /^\s*_{5,}\s*$/m,                 // Outlook divider
    /^\s*From:\s.+$/im,
    /^\s*--\s*$/m,                    // signature delimiter
    /^\s*Sent from my /im,
  ];
  for (const marker of cutMarkers) {
    const m = text.match(marker);
    if (m?.index != null) text = text.slice(0, m.index);
  }
  // Drop leading ">" quote lines that survived.
  text = text.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
