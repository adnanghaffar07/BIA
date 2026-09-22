/**
 * The fifteen-minute sweep that makes the platform agree with the CRM (Sec. 11.5 Q4).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-reconcile.mjs
 *
 * NO REAL CAMPAIGN IS TOUCHED. The apply-path cases (5-7) run against an injected stub
 * that records what it was asked to remove instead of calling the vendor, so the
 * destructive branch is exercised without deleting anybody. The rows this writes go in a
 * campaign id that exists only for this run and are removed in `finally`.
 *
 * The point of the suite is the decision table — which recipient the sweep removes and
 * which it leaves — because every wrong answer in it is either a customer who keeps
 * getting mail after saying stop, or a live recipient deleted for no reason.
 *
 * Case 9 runs with no stub at all. It is the one that catches a query that typechecks and
 * then fails against the real schema, which is where the last bug was: a "householdKey"
 * column selected from Lead that does not exist. It reads only.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { reconcileOutreach, summarise } from '@/services/outreachReconcile.service';
import { householdScopeKey } from '@/services/household.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };

const TEST_CAMPAIGN = `recon-test-${Date.now()}`;
const LEAD = (await sql`SELECT "id","addressStreet","addressZip","householdId" FROM "Lead"
                         WHERE "addressStreet" IS NOT NULL AND "addressZip" IS NOT NULL
                         ORDER BY "id" LIMIT 1`)[0];
if (!LEAD) { console.error('no usable lead'); process.exit(1); }
// The stored household id (migration 034) — what suppress() writes and every reader
// looks up. The address-derived key it replaced could not name a household spanning two
// properties, which is precisely the case case 3 below exercises.
const HK = householdScopeKey(LEAD);
console.log(`lead ${LEAD.id} · household ${HK}\n`);

const ev = async (email, vendorLeadId, stoppedAt = null) => {
  await sql`
    INSERT INTO "OutreachEvent" ("id","leadId","recipientEmail","channel","vendorLeadId",
                                 "vendorCampaignId","stoppedAt","stoppedReason","createdAt","updatedAt")
    VALUES (${`t-${vendorLeadId}`}, ${LEAD.id}, ${email}, 'email', ${vendorLeadId},
            ${TEST_CAMPAIGN}, ${stoppedAt}, ${stoppedAt ? 'replied elsewhere' : null}, NOW(), NOW())`;
};

const cleanup = async () => {
  await sql`DELETE FROM "OutreachEvent" WHERE "vendorCampaignId" = ${TEST_CAMPAIGN}`;
  await sql`DELETE FROM "Suppression" WHERE "createdBy" = 'test-reconcile'`;
};

try {
  await cleanup();

  // Three recipients on the platform. Only some of them should be removed.
  await ev('stopped@example.com', 'v-stopped', new Date());
  await ev('suppressed@example.com', 'v-suppressed', null);
  await ev('fine@example.com', 'v-fine', null);

  await sql`
    INSERT INTO "Suppression" ("id","scope","email","householdKey","leadId","reason","source","createdAt","createdBy")
    VALUES (${`s-${Date.now()}`}, 'address', 'suppressed@example.com', NULL, ${LEAD.id},
            'unsubscribed', 'test', NOW(), 'test-reconcile')`;

  // The platform, stated rather than called. Three of ours plus one it has that we do not.
  const live = [
    { id: 'v-stopped', email: 'stopped@example.com', campaign: TEST_CAMPAIGN },
    { id: 'v-suppressed', email: 'suppressed@example.com', campaign: TEST_CAMPAIGN },
    { id: 'v-fine', email: 'fine@example.com', campaign: TEST_CAMPAIGN },
    { id: 'v-stranger', email: 'stranger@example.com', campaign: TEST_CAMPAIGN },
  ];
  const removed = [];
  const deps = {
    listLive: async () => live,
    remove: async (id) => { removed.push(id); },
  };

  console.log('--- 1. the decision table ---');
  const r = await reconcileOutreach({ dryRun: true, campaignId: TEST_CAMPAIGN, deps });
  const kindOf = (email) => r.findings.find((f) => f.email === email)?.kind ?? 'none';

  ok('stopped here, live there -> corrected', kindOf('stopped@example.com') === 'stopped_here_live_there', kindOf('stopped@example.com'));
  ok('suppressed here, live there -> corrected', kindOf('suppressed@example.com') === 'suppressed_here_live_there', kindOf('suppressed@example.com'));
  ok('a healthy recipient is LEFT ALONE', kindOf('fine@example.com') === 'none', kindOf('fine@example.com'));
  ok('a stranger is reported, not removed', kindOf('stranger@example.com') === 'live_there_unknown_here', kindOf('stranger@example.com'));
  ok('the stranger is counted as unknown', r.unknown === 1, String(r.unknown));
  ok('all four live recipients were seen', r.vendorRecipients === 4, String(r.vendorRecipients));

  console.log('--- 2. a dry run removes nothing ---');
  ok('nothing removed', r.removed === 0);
  ok('flagged as a dry run', r.dryRun === true);
  ok('no finding claims to have been acted on', r.findings.every((f) => f.removed === undefined));

  console.log('--- 3. household-scope suppression reaches a DIFFERENT address ---');
  await sql`DELETE FROM "Suppression" WHERE "createdBy" = 'test-reconcile'`;
  await sql`
    INSERT INTO "Suppression" ("id","scope","email","householdKey","leadId","reason","source","createdAt","createdBy")
    VALUES (${`s-hh-${Date.now()}`}, 'household', NULL, ${HK}, ${LEAD.id},
            'asked us to stop', 'test', NOW(), 'test-reconcile')`;
  const r2 = await reconcileOutreach({ dryRun: true, campaignId: TEST_CAMPAIGN, deps });
  const k2 = (e) => r2.findings.find((f) => f.email === e)?.kind ?? 'none';
  // This is the case that would have thrown on the missing column rather than failing a check.
  ok('the household stop catches an address never named in it',
    k2('fine@example.com') === 'suppressed_here_live_there', k2('fine@example.com'));
  ok('and still does not touch the stranger, who has no lead',
    k2('stranger@example.com') === 'live_there_unknown_here', k2('stranger@example.com'));

  console.log('--- 4. the ceiling refuses a suspicious diff ---');
  const r3 = await reconcileOutreach({ dryRun: false, campaignId: TEST_CAMPAIGN, maxRemovals: 1, deps });
  ok('an oversized diff stops instead of acting', r3.stopped !== null);
  ok('and removed nothing', r3.removed === 0);
  ok('and says why', /ceiling/.test(r3.stopped?.detail ?? ''), r3.stopped?.detail);

  console.log('--- 5. an apply run removes exactly the right recipients ---');
  // Back to an address-scope suppression so the two cases are distinct again.
  await sql`DELETE FROM "Suppression" WHERE "createdBy" = 'test-reconcile'`;
  await sql`
    INSERT INTO "Suppression" ("id","scope","email","householdKey","leadId","reason","source","createdAt","createdBy")
    VALUES (${`s-a-${Date.now()}`}, 'address', 'suppressed@example.com', NULL, ${LEAD.id},
            'unsubscribed', 'test', NOW(), 'test-reconcile')`;
  removed.length = 0;
  const r4 = await reconcileOutreach({ dryRun: false, campaignId: TEST_CAMPAIGN, deps });
  ok('removed both that should stop', r4.removed === 2, String(r4.removed));
  ok('the stopped one was removed', removed.includes('v-stopped'), removed.join(','));
  ok('the suppressed one was removed', removed.includes('v-suppressed'), removed.join(','));
  ok('the healthy recipient was NOT removed', !removed.includes('v-fine'), removed.join(','));
  ok('the stranger was NOT removed', !removed.includes('v-stranger'), removed.join(','));
  ok('nothing failed', r4.failed === 0);

  // The suppression case gets stamped so the next sweep does not re-find it.
  const stamped = await sql`
    SELECT "stoppedAt","stoppedBy" FROM "OutreachEvent"
     WHERE "vendorCampaignId" = ${TEST_CAMPAIGN} AND "recipientEmail" = 'suppressed@example.com'`;
  ok('the suppressed row is now stamped stopped', stamped[0]?.stoppedAt != null);
  ok('and attributed to the sweep', stamped[0]?.stoppedBy === 'reconcile', String(stamped[0]?.stoppedBy));

  console.log('--- 6. a second sweep is a no-op (idempotent) ---');
  removed.length = 0;
  const r5 = await reconcileOutreach({ dryRun: false, campaignId: TEST_CAMPAIGN, deps });
  // Still listed as live by the stub, so they are still found — but re-removing is safe
  // and the stamp means the reason no longer has to be re-derived from suppression.
  ok('re-running does not touch the healthy recipient', !removed.includes('v-fine'), removed.join(','));
  ok('and still leaves the stranger alone', !removed.includes('v-stranger'), removed.join(','));
  ok('and reports no failures', r5.failed === 0);

  console.log('--- 7. a vendor that refuses is reported, not swallowed ---');
  const r6 = await reconcileOutreach({
    dryRun: false, campaignId: TEST_CAMPAIGN,
    deps: { listLive: async () => live, remove: async () => { throw new Error('platform said no'); } },
  });
  ok('a failed removal is counted', r6.failed > 0, String(r6.failed));
  ok('and nothing is claimed as removed', r6.removed === 0, String(r6.removed));
  ok('and the error is attached to the finding',
    r6.findings.some((f) => f.error === 'platform said no'));

  console.log('--- 8. the summary line ---');
  ok('summary mentions the campaign count', /campaign/.test(summarise(r)));
  ok('summary names the untouched strangers', /unknown/.test(summarise(r)), summarise(r));

  console.log("--- 9. against the real schema, no stub ---");
  const realRun = await reconcileOutreach({ dryRun: true });
  console.log(`    ${summarise(realRun)}`);
  ok('a real dry run completes without throwing', Array.isArray(realRun.findings));
  ok('and removes nothing', realRun.removed === 0);
} finally {
  await cleanup();
  const left = await sql`SELECT COUNT(*)::int n FROM "OutreachEvent" WHERE "vendorCampaignId" = ${TEST_CAMPAIGN}`;
  const sLeft = await sql`SELECT COUNT(*)::int n FROM "Suppression" WHERE "createdBy" = 'test-reconcile'`;
  console.log(`\ncleanup: ${left[0].n} events, ${sLeft[0].n} suppressions left (both should be 0)`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
