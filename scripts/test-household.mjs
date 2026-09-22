/**
 * The household is a record, and every reader agrees with it (Sec. 11.5 question 2).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-household.mjs
 *
 * Writes a suppression on one real lead and removes it in `finally`. Nothing is sent and
 * no vendor is called.
 *
 * The case that matters is a household spanning TWO properties. Under the old scheme its
 * members had different keys — one derived from each address — so a household-wide stop
 * recorded on one of them was invisible to the other. That is a stop that looks like it
 * worked and leaves half a household still being mailed, which is the exact failure the
 * stored record exists to prevent.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { groupHouseholds, householdScopeKey, householdKeyOf } from '@/services/household.service';
import { suppress, suppressionFor, loadActiveSuppressions } from '@/services/suppression.service';
import { householdMismatches, multiAddressHouseholds } from '@/services/householdStore.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const cleanup = () => sql`DELETE FROM "Suppression" WHERE "createdBy" = 'test-household'`;

try {
  await cleanup();

  console.log('--- 1. the grouping is order-independent ---');
  const COLS = `"id","addressStreet","addressZip","householdId","email1","email2","owner2Email","emailsAll","skipTraceData"`;
  const leads = await sql(COLS ? `SELECT ${COLS} FROM "Lead"` : '');
  const sig = (xs) => groupHouseholds(xs).households
    .map((h) => [...h.leadIds].sort().join(',')).sort().join('|');
  const base = sig(leads);
  let stable = true;
  for (let i = 0; i < 3; i++) {
    if (sig([...leads].sort(() => Math.random() - 0.5)) !== base) { stable = false; break; }
  }
  ok('same partition whatever order the rows arrive in', stable);

  console.log('--- 2. every lead has a stored household ---');
  const [c] = await sql`
    SELECT COUNT(*) FILTER (WHERE "householdId" IS NULL)::int AS unassigned,
           COUNT(*)::int AS total FROM "Lead"`;
  eq('no lead is unassigned', c.unassigned, 0);

  const [orph] = await sql`
    SELECT COUNT(*)::int n FROM "Lead" l
     WHERE l."householdId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Household" h WHERE h."id" = l."householdId")`;
  eq('no lead points at a household that does not exist', orph.n, 0);

  const [drift] = await sql`
    SELECT COUNT(*)::int n FROM "Household" h
     WHERE h."leadCount" <> (SELECT COUNT(*) FROM "Lead" l WHERE l."householdId" = h."id")`;
  eq('stored leadCount matches the members', drift.n, 0);

  console.log('--- 3. re-deriving agrees with what is stored ---');
  const m = await householdMismatches();
  eq('no mismatches', m.mismatches.length, 0);

  console.log('--- 4. the scope key prefers the stored id ---');
  const [withId] = await sql`
    SELECT * FROM "Lead" WHERE "householdId" IS NOT NULL ORDER BY "id" LIMIT 1`;
  eq('stored id wins over the derived key', householdScopeKey(withId), withId.householdId);
  ok('and the derived key is genuinely different',
    householdKeyOf(withId) !== withId.householdId, householdKeyOf(withId));
  eq('a lead with no stored id falls back to the address key',
    householdScopeKey({ id: 'x', addressStreet: '1 Test St', addressZip: '07728' }),
    'hh:1 test st|07728');

  console.log('--- 5. a stop on one property reaches the other ---');
  const multi = await multiAddressHouseholds();
  ok('there is a household spanning more than one property to test with', multi.length > 0);
  if (multi.length) {
    const h = multi[0];
    const members = await sql`
      SELECT * FROM "Lead" WHERE "householdId" = ${h.id} ORDER BY "id"`;
    ok('it has at least two members', members.length >= 2);
    const [a, b] = members;
    console.log(`    ${h.id}: lead ${a.id} and lead ${b.id}, different properties`);

    // Recorded against ONE of them.
    await suppress({
      lead: a, leadId: String(a.id), reason: 'not_interested',
      source: 'test', createdBy: 'test-household', note: 'household scope test',
    });

    const hitA = await suppressionFor(a, 'someone@example.com');
    const hitB = await suppressionFor(b, 'different@example.com');
    ok('the lead it was recorded on is suppressed', hitA != null);
    // The assertion the whole change is for.
    ok('THE OTHER PROPERTY IS ALSO SUPPRESSED', hitB != null,
      'a household stop reached only half the household');
    eq('and for the same reason', hitB?.reason, 'not_interested');

    const bulk = await loadActiveSuppressions();
    ok('the bulk loader sees the household', bulk.households.has(String(a.householdId)));
    ok('and both members resolve to that key',
      householdScopeKey(a) === householdScopeKey(b));

    // Under the old scheme these two differed, which is what made the stop miss.
    ok('their address-derived keys DID differ — the old failure',
      householdKeyOf(a) !== householdKeyOf(b),
      `${householdKeyOf(a)} vs ${householdKeyOf(b)}`);
  }

  console.log('--- 5b. the transactional path keys on the household too ---');
  /**
   * The webhook records unsubscribes and complaints through suppressWithClient, inside
   * its own transaction, and used to pass a householdKey it had derived from a lead
   * literal holding only id, street and zip — so it passed the ADDRESS key, and the
   * explicit value beat the resolver. Those two are the most consequential suppressions
   * there are, and they were being written under a string no reader looks up.
   *
   * Exercised with a caller-supplied key that is deliberately WRONG: the stored household
   * must win anyway.
   */
  await cleanup();
  const { pool } = await import('@/lib/neon');
  const { suppressWithClient } = await import('@/services/suppression.service');
  const [webhookLead] = await sql`
    SELECT "id","addressStreet","addressZip","householdId" FROM "Lead"
     WHERE "householdId" IS NOT NULL ORDER BY "id" LIMIT 1`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await suppressWithClient(client, {
      leadId: String(webhookLead.id),
      email: 'someone@example.com',
      reason: 'unsubscribe',
      householdKey: 'hh:a-stale-derived-key|00000',   // what the webhook used to send
      source: 'test', createdBy: 'test-household',
    });
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

  const [written] = await sql`
    SELECT "householdKey","scope" FROM "Suppression" WHERE "createdBy" = 'test-household'`;
  eq('the transactional path is household scope', written?.scope, 'household');
  eq('and keys on the STORED household, not the key it was handed',
    written?.householdKey, webhookLead.householdId);
  ok('so a reader finds it', (await suppressionFor(webhookLead, 'anything@example.com')) != null);

  console.log('--- 6. an ordinary single-property household still works ---');
  await cleanup();
  const [solo] = await sql`
    SELECT l.* FROM "Lead" l JOIN "Household" h ON h."id" = l."householdId"
     WHERE h."leadCount" = 1 AND h."addressKey" IS NOT NULL ORDER BY l."id" LIMIT 1`;
  await suppress({
    lead: solo, leadId: String(solo.id), reason: 'dnc',
    source: 'test', createdBy: 'test-household',
  });
  const soloHit = await suppressionFor(solo, 'anything@example.com');
  ok('a single-property household suppresses', soloHit != null);
  eq('keyed on the stored id', (await sql`
    SELECT "householdKey" FROM "Suppression" WHERE "createdBy" = 'test-household' LIMIT 1`)[0].householdKey,
    solo.householdId);
} finally {
  await cleanup();
  const [left] = await sql`
    SELECT COUNT(*)::int n FROM "Suppression" WHERE "createdBy" = 'test-household'`;
  console.log(`\ncleanup: ${left.n} test suppression(s) left (should be 0)`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
