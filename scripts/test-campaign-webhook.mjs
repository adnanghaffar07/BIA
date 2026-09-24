/**
 * The campaign webhook's event vocabulary — does every outcome reach a column?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-campaign-webhook.mjs
 *
 * Pure. No database, no vendor, writes nothing.
 *
 * -- Why this suite exists ---------------------------------------------------
 * The webhook is the only thing that turns a send into data. Everything the outreach
 * dashboard reports below "loaded" comes from it, and a dropped event type is invisible:
 * the vendor gets its 200, nothing errors, and a column simply stays empty forever.
 *
 * That had already happened. classifyEvent folded 'deliver' into 'sent', so no code
 * anywhere wrote deliveredAt -- and Sec 10.7 measures engagement ON DELIVERED. The
 * engagement rate, its 27% target and the 18% floor that triggers the Pivot Plan all
 * rested on a column nothing populated, and the dashboard would have read zero delivered
 * for as long as anyone cared to look.
 *
 * So this asserts the mapping itself, against the labels vendors actually send.
 */
import './lib/env.mjs';
import { classifyEvent, readPayload } from '@/lib/integrations/campaignWebhook';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log('--- 1. delivered is its own kind, not a send ---');
/**
 * Vendors label this "email_delivered", "delivered", "message.delivered". Every one of
 * them contains neither more nor less than the word that matters, and the string
 * "email_delivered" does NOT contain "sent" — but the ordering still matters, because a
 * future label like "sent_and_delivered" would otherwise be classified as a send.
 */
for (const label of ['delivered', 'email_delivered', 'message.delivered', 'EMAIL_DELIVERED', 'sent_and_delivered']) {
  eq(`"${label}" classifies as delivered`, classifyEvent(label), 'delivered');
}

console.log('--- 2. sent is still sent ---');
for (const label of ['sent', 'email_sent', 'EmailSent']) {
  eq(`"${label}" classifies as sent`, classifyEvent(label), 'sent');
}

console.log('--- 3. every other outcome still lands where it did ---');
const CASES = [
  ['reply_received', 'reply'], ['lead_replied', 'reply'],
  ['bounced', 'bounce'], ['hard_bounce', 'bounce'],
  ['unsubscribed', 'unsubscribe'], ['email_unsubscribe', 'unsubscribe'],
  ['spam_complaint', 'complaint'], ['complained', 'complaint'],
  ['link_clicked', 'click'], ['email_opened', 'open'],
];
for (const [label, want] of CASES) eq(`"${label}" -> ${want}`, classifyEvent(label), want);

console.log('--- 4. the orderings that could go wrong ---');
/**
 * These are the collisions the substring matching has to survive. "unsubscribed" contains
 * "sub"; the classifier checks it first for that reason. Each case below is one where a
 * plausible reordering silently changes the meaning of a real event.
 */
eq('unsubscribe is not read as a send', classifyEvent('unsubscribed'), 'unsubscribe');
eq('a spam complaint is not read as a send', classifyEvent('spam_report'), 'complaint');
eq('a bounce is not read as a delivery', classifyEvent('email_bounced'), 'bounce');
/** A reply to a delivered message is a reply — the outcome wins over the transport. */
eq('a reply is not read as a delivery', classifyEvent('reply_to_delivered'), 'reply');

console.log('--- 5. nothing unknown is invented ---');
for (const label of ['', null, undefined, 'something_else', 'campaign_paused']) {
  eq(`${JSON.stringify(label)} classifies as null`, classifyEvent(label), null);
}

console.log('--- 6. the payload reader finds what the handlers need ---');
/** Vendors put these in different places; the reader has to find them in any of them. */
const p = readPayload({
  event_type: 'email_delivered',
  lead: { email: 'Someone@Example.COM', id: 'v-123' },
  campaign_id: 'camp-1',
  step: '2',
});
eq('event type read', p.eventType, 'email_delivered');
eq('email read and lowercased', p.email, 'someone@example.com');
eq('vendor lead id read', p.vendorLeadId, 'v-123');
eq('campaign id read', p.campaignId, 'camp-1');
eq('step read as a number', p.step, 2);

const flat = readPayload({ type: 'delivered', email: 'a@b.com', lead_id: 'x' });
eq('a flat payload works too', classifyEvent(flat.eventType), 'delivered');
eq('...and still finds the lead id', flat.vendorLeadId, 'x');

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
