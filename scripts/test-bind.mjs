/**
 * Recording a sale, and what it stops (directive Sec. 11.5 question 6).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-bind.mjs
 *
 * Writes to the live database on one marked lead and restores it in `finally`.
 *
 * The case that actually matters is the third one. A bound customer who keeps receiving
 * cold email about the policy they have just bought is the most embarrassing message this
 * system can send, and the only thing standing between us and it is that recordBind
 * suppresses the HOUSEHOLD rather than the one mailbox that answered.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { recordBind, recordLoss, quoteState } from '@/services/quoteOutcomes.service';
import { suppressionFor, loadActiveSuppressions } from '@/services/suppression.service';
import { householdScopeKey } from '@/services/household.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const [seed] = await sql`
  SELECT * FROM "Lead"
   WHERE "addressStreet" IS NOT NULL AND "addressZip" IS NOT NULL
   ORDER BY "id" LIMIT 1`;
if (!seed) { console.error('no usable lead'); process.exit(1); }
// The key a suppression is actually recorded under: the STORED household id since
// migration 034, not the address-derived string. Asserting on the old one tested a
// scheme no reader uses any more.
const HK = householdScopeKey(seed);
console.log(`lead ${seed.id} · household ${HK}\n`);

const restore = async () => {
  await sql`
    UPDATE "Lead" SET
      "status" = ${seed.status}, "boundDate" = ${seed.boundDate},
      "boundPremium" = ${seed.boundPremium}, "boundCarrier" = ${seed.boundCarrier ?? null},
      "boundPolicyNumber" = ${seed.boundPolicyNumber ?? null},
      "boundEffectiveDate" = ${seed.boundEffectiveDate ?? null},
      "boundNotes" = ${seed.boundNotes ?? null}, "boundBy" = ${seed.boundBy ?? null},
      "bandHit" = ${seed.bandHit}, "bandVariancePct" = ${seed.bandVariancePct},
      "bandMeasuredAt" = ${seed.bandMeasuredAt},
      "publishedBandLow" = ${seed.publishedBandLow}, "publishedBandHigh" = ${seed.publishedBandHigh},
      "indicativeBandLow" = ${seed.indicativeBandLow}, "indicativeBandHigh" = ${seed.indicativeBandHigh},
      "quotedPremium" = ${seed.quotedPremium},
      "lostAt" = ${seed.lostAt}, "lostReason" = ${seed.lostReason}, "lostNotes" = ${seed.lostNotes},
      "revisitFlag" = ${seed.revisitFlag ?? false}, "revisitDate" = ${seed.revisitDate},
      "revisitNote" = ${seed.revisitNote}
    WHERE "id" = ${seed.id}`;
  await sql`DELETE FROM "Activity" WHERE "leadId" = ${seed.id} AND "createdBy" = 'test-bind'`;
  await sql`DELETE FROM "Suppression" WHERE "leadId" = ${seed.id} AND "source" = 'bind'`;
};

try {
  await restore();

  console.log('--- 1. the policy is recorded ---');
  await sql`UPDATE "Lead" SET "publishedBandLow" = 2000, "publishedBandHigh" = 2400 WHERE "id" = ${seed.id}`;
  const r = await recordBind({
    leadId: seed.id, premium: 2200, carrier: 'Travelers',
    policyNumber: 'HO-123456', effectiveDate: '2026-11-20',
    notes: 'bound on the call', by: 'test-bind',
  });
  const st = await quoteState(seed.id);
  eq('premium stored', st.bound?.premium, 2200);
  eq('carrier stored', st.bound?.carrier, 'Travelers');
  eq('policy number stored', st.bound?.policyNumber, 'HO-123456');
  eq('effective date stored', st.bound?.effectiveDate, '2026-11-20');
  eq('who entered it stored', st.bound?.by, 'test-bind');
  const [l1] = await sql`SELECT "status" FROM "Lead" WHERE "id" = ${seed.id}`;
  eq('status moved to bound', l1.status, 'bound');

  console.log('--- 2. measured against the PUBLISHED band ---');
  eq('inside the published band', r.bandHit, true);
  eq('no variance at the midpoint', r.variancePct, 0);

  await restore();
  await sql`
    UPDATE "Lead" SET "publishedBandLow" = 1000, "publishedBandHigh" = 1200,
           "indicativeBandLow" = 2000, "indicativeBandHigh" = 2400 WHERE "id" = ${seed.id}`;
  const r2 = await recordBind({ leadId: seed.id, premium: 2200, carrier: 'Travelers', by: 'test-bind' });
  ok('a premium inside the CURRENT band still misses the PUBLISHED one', r2.bandHit === false,
    `hit=${r2.bandHit}`);

  console.log('--- 3. the household stops being contacted ---');
  eq('suppression reported', r2.suppressed, true);
  eq('and no error', r2.suppressionError, null);
  const [sup] = await sql`
    SELECT "scope","reason","householdKey","email" FROM "Suppression"
     WHERE "leadId" = ${seed.id} AND "source" = 'bind' AND "releasedAt" IS NULL`;
  ok('a suppression row exists', !!sup);
  eq('scoped to the HOUSEHOLD, not one mailbox', sup?.scope, 'household');
  eq('reason is the sale', sup?.reason, 'bound');
  eq('keyed on this household', sup?.householdKey, HK);

  // The point of household scope: an address never named in the suppression is covered.
  const hit = await suppressionFor(seed, 'someone.else@example.com');
  ok('an address never named in it is still suppressed', hit != null, JSON.stringify(hit));
  eq('and for the right reason', hit?.reason, 'bound');

  const bulk = await loadActiveSuppressions();
  ok('the send list loader sees the household', bulk.households.has(HK));

  console.log('--- 3b. and the PUSH actually refuses them ---');
  /**
   * The assertion the whole feature rests on.
   *
   * Suppressing without the send path reading it is decorative: campaignPush used to
   * consult four Lead columns and never the Suppression table, so a bound household was
   * recorded as suppressed and pushed to anyway. Checked against the real triage, not
   * against the suppression row that was just written.
   */
  const { triagePush } = await import('@/services/campaignPush.service');
  const eff = String(seed.effectiveDate).slice(0, 10);
  const tri = await triagePush('test-campaign-never-used', {
    effectiveDate: eff, effectiveTo: eff,
  }, { recipients: 'both' });
  const pushed = tri.eligible.filter((r) => String(r.lead.id) === String(seed.id));
  eq('a bound household is not in the eligible list', pushed.length, 0);
  ok('and it is counted as suppressed rather than dropped silently', tri.skipped.suppressed > 0,
    JSON.stringify(tri.skipped));

  console.log('--- 4. a sale clears a loss recorded in error ---');
  await restore();
  await sql`UPDATE "Lead" SET "quotedPremium" = 2200 WHERE "id" = ${seed.id}`;
  await recordLoss({ leadId: seed.id, reason: 'premium', competingPremium: 1900, by: 'test-bind' });
  const [mid] = await sql`SELECT "lostAt","revisitFlag" FROM "Lead" WHERE "id" = ${seed.id}`;
  ok('loss recorded first', mid.lostAt != null);
  await recordBind({ leadId: seed.id, premium: 2100, carrier: 'Plymouth Rock', by: 'test-bind' });
  const [after] = await sql`SELECT "lostAt","lostReason","revisitFlag","revisitDate" FROM "Lead" WHERE "id" = ${seed.id}`;
  ok('the loss is cleared — a lead cannot be both won and lost', after.lostAt == null && after.lostReason == null);
  ok('and the revisit reminder is cleared with it', after.revisitFlag === false && after.revisitDate == null);

  console.log('--- 5. what it refuses ---');
  for (const [name, input] of [
    ['a premium of zero', { leadId: seed.id, premium: 0, carrier: 'X' }],
    ['a negative premium', { leadId: seed.id, premium: -100, carrier: 'X' }],
    ['a missing carrier', { leadId: seed.id, premium: 1200, carrier: '  ' }],
  ]) {
    let threw = false;
    try { await recordBind({ ...input, by: 'test-bind' }); } catch { threw = true; }
    ok(`refuses ${name}`, threw);
  }

  console.log('--- 6. it is written down ---');
  const acts = await sql`
    SELECT "content","metadata" FROM "Activity"
     WHERE "leadId" = ${seed.id} AND "createdBy" = 'test-bind' ORDER BY "createdAt"`;
  ok('an activity row per bind', acts.length >= 2, String(acts.length));
  const last = acts[acts.length - 1];
  ok('it names the carrier and the premium', /Plymouth Rock/.test(last.content) && /2100/.test(last.content), last.content);
  ok('it says outreach stopped', /outreach stopped/i.test(last.content), last.content);
  ok('and carries the policy in metadata', last.metadata?.bound?.carrier === 'Plymouth Rock');
} finally {
  await restore();
  const [l] = await sql`SELECT "status","boundPremium","boundCarrier","lostReason" FROM "Lead" WHERE "id" = ${seed.id}`;
  const left = await sql`SELECT COUNT(*)::int n FROM "Suppression" WHERE "leadId" = ${seed.id} AND "source" = 'bind'`;
  console.log(`\ncleanup: status=${l.status} bound=${l.boundPremium ?? 'null'}/${l.boundCarrier ?? 'null'} lost=${l.lostReason ?? 'null'} · ${left[0].n} bind suppressions left (should be 0)`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
