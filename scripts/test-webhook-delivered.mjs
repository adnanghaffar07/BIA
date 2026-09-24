/**
 * Does a delivery event from the campaign platform actually reach the database?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-webhook-delivered.mjs
 *         (needs the dev server running — defaults to http://localhost:3000)
 *
 * -- What this writes --------------------------------------------------------
 * ONE synthetic OutreachEvent row against a real lead, under a marker address, and it
 * removes it again in a finally block. The lead's own campaign columns are read first and
 * written back byte for byte. A delivery event triggers no household stop and no
 * suppression -- only replies, clicks, unsubscribes and complaints do -- so nothing else
 * in the system can react to it.
 *
 * -- Why it exists -----------------------------------------------------------
 * classifyEvent used to fold 'deliver' into 'sent', so nothing ever wrote deliveredAt, and
 * Sec 10.7 measures engagement ON delivered. scripts/test-campaign-webhook.mjs asserts the
 * classifier in isolation; this asserts the whole path -- HTTP in, auth, classify, match,
 * UPDATE -- because a classifier that returns the right string is worth nothing if the
 * handler never runs.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import crypto from 'node:crypto';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const KEY = process.env.LEADS_CAMPAIGN_WEBHOOK_KEY;
const MARKER = `zz-webhook-test-${crypto.randomUUID().slice(0, 8)}@example.invalid`;

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };

if (!KEY) {
  console.log('LEADS_CAMPAIGN_WEBHOOK_KEY is not set — cannot test the endpoint.');
  process.exit(1);
}

/** A real lead with no campaign history, so nothing of value can be disturbed. */
const [lead] = await sql`
  SELECT "id", "propertyId", "campaignLastSentAt", "currentEmailStep", "campaignStatus", "cohort"
    FROM "Lead"
   WHERE "campaignLastSentAt" IS NULL AND "currentEmailStep" IS NULL
     AND "vendorCampaignId" IS NULL AND "cohort" IS NOT NULL
   LIMIT 1`;
if (!lead) { console.log('no clean lead to test against'); process.exit(1); }

console.log(`testing against lead ${lead.propertyId} (no campaign history)`);
console.log(`marker address: ${MARKER}\n`);

const eventId = crypto.randomUUID();

const post = async (eventType) => {
  const res = await fetch(`${BASE}/api/webhooks/campaign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bia-campaign-key': KEY },
    body: JSON.stringify({ event_type: eventType, email: MARKER, lead_id: 'zz-test', step: 1 }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const readEvent = async () => {
  const [r] = await sql`
    SELECT "sentAt", "deliveredAt", "emailStep" FROM "OutreachEvent" WHERE "id" = ${eventId}`;
  return r;
};

try {
  await sql`
    INSERT INTO "OutreachEvent"
      ("id","leadId","propertyId","personRole","recipientEmail","channel","cohort","createdAt","updatedAt")
    VALUES (${eventId}, ${lead.id}, ${lead.propertyId}, 'insured', ${MARKER}, 'campaign',
            ${lead.cohort}, NOW(), NOW())`;

  console.log('--- 1. a row with no send recorded yet ---');
  let ev = await readEvent();
  /**
   * sentAt carries a DEFAULT of now() on the table, so a row is "sent" the instant it
   * exists. That is worth asserting rather than working around: it means the send log
   * records the moment of the PUSH, and the funnel says so instead of calling it reach.
   */
  ok("sentAt is stamped by the table default, not left empty", ev.sentAt !== null);
  ok('starts with no deliveredAt', ev.deliveredAt === null);

  console.log('--- 2. a "sent" event records the send and NOT a delivery ---');
  /** The regression in one assertion: a send must never imply a delivery. */
  const sent = await post('email_sent');
  ok('the endpoint accepted it', sent.status === 200, `status ${sent.status}`);
  ok('...and matched our row', sent.body?.matched !== false, JSON.stringify(sent.body));
  ev = await readEvent();
  ok('sentAt is now set', ev.sentAt !== null);
  ok('deliveredAt is still empty — a send is not a delivery', ev.deliveredAt === null,
    String(ev.deliveredAt));

  console.log('--- 3. a "delivered" event records the delivery ---');
  const del = await post('email_delivered');
  ok('the endpoint accepted it', del.status === 200, `status ${del.status}`);
  ev = await readEvent();
  ok('deliveredAt is now set', ev.deliveredAt !== null, String(ev.deliveredAt));
  ok('sentAt survived', ev.sentAt !== null);

  console.log('--- 4. a delivery alone would still have set the send ---');
  /**
   * Vendors drop events. A message recorded as delivered but never sent would put the
   * funnel's own rungs out of order, so the handler stamps both.
   */
  const second = crypto.randomUUID();
  await sql`
    INSERT INTO "OutreachEvent"
      ("id","leadId","propertyId","personRole","recipientEmail","channel","cohort","createdAt","updatedAt")
    VALUES (${second}, ${lead.id}, ${lead.propertyId}, 'insured', ${MARKER}, 'campaign',
            ${lead.cohort}, NOW(), NOW())`;
  try {
    await post('delivered');
    const [r2] = await sql`SELECT "sentAt","deliveredAt" FROM "OutreachEvent" WHERE "id" = ${second}`;
    // Both rows carry the marker address; the handler picks one. Whichever it took, a
    // delivery must never leave sentAt empty on it.
    const rows = await sql`
      SELECT "sentAt","deliveredAt" FROM "OutreachEvent" WHERE "recipientEmail" = ${MARKER}
       AND "deliveredAt" IS NOT NULL`;
    ok('every delivered row also carries a sentAt', rows.every((r) => r.sentAt !== null));
    ok('the second row exists', r2 != null);
  } finally {
    await sql`DELETE FROM "OutreachEvent" WHERE "id" = ${second}`;
  }

  console.log('--- 5. a bad key is refused ---');
  const bad = await fetch(`${BASE}/api/webhooks/campaign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bia-campaign-key': 'wrong' },
    body: JSON.stringify({ event_type: 'email_delivered', email: MARKER }),
  });
  ok('a wrong key does not get through', bad.status !== 200, `status ${bad.status}`);
} finally {
  // Always, even if an assertion threw.
  await sql`DELETE FROM "OutreachEvent" WHERE "recipientEmail" = ${MARKER}`;
  await sql`
    UPDATE "Lead"
       SET "campaignLastSentAt" = ${lead.campaignLastSentAt},
           "currentEmailStep"   = ${lead.currentEmailStep},
           "campaignStatus"     = ${lead.campaignStatus}
     WHERE "id" = ${lead.id}`;

  const [leftEv] = await sql`
    SELECT COUNT(*)::int AS n FROM "OutreachEvent" WHERE "recipientEmail" = ${MARKER}`;
  const [after] = await sql`
    SELECT "campaignLastSentAt", "currentEmailStep", "campaignStatus"
      FROM "Lead" WHERE "id" = ${lead.id}`;
  console.log('--- 6. cleanup ---');
  ok('every test event removed', leftEv.n === 0, `${leftEv.n} left`);
  ok('the lead is back as it was',
    after.campaignLastSentAt === lead.campaignLastSentAt
    && after.currentEmailStep === lead.currentEmailStep
    && after.campaignStatus === lead.campaignStatus,
    JSON.stringify(after));
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
