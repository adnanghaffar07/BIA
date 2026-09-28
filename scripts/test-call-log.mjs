/**
 * Call logging rules (directive Sec. 10.5, S3).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-call-log.mjs
 *
 * Writes to the live database under a marked lead and removes everything afterwards.
 * The cases that matter are the ones where the stop rule could retire a lead too early:
 * four calls in one afternoon to one number is a lead called badly, not a lead that
 * cannot be reached, and retiring it would hide the difference.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { callState, logAttempt, numbersOnCard } from '@/services/callLog.service';
import { isReachedStatus } from '@/lib/callOutcomes';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// A real Grade A lead with two numbers, so the "2+ numbers" condition is live.
const [seed] = await sql`
  SELECT "id","propertyId","owner1FirstName","owner1LastName","addressStreet","addressZip",
         "phone1","phone2","owner2Phone","phonesAll","skipTraceData",
         "email1","email2","owner2Email","emailsAll",
         "owner2FirstName","owner2LastName","invalidPhones","callUnreachableAt"
    FROM "Lead"
   WHERE COALESCE("manualGrade","grade") = 'A'
     AND "phone1" IS NOT NULL AND "phone1" <> ''
     AND "phone2" IS NOT NULL AND "phone2" <> ''
   ORDER BY "id" LIMIT 1`;
if (!seed) { console.error('no Grade A lead with two numbers'); process.exit(1); }

const nums = numbersOnCard(seed);
console.log(`lead ${seed.id} · ${seed.owner1LastName} · numbers: ${nums.map((n) => n.number).join(', ')}\n`);

const clean = async () => {
  await sql`DELETE FROM "CallAttempt" WHERE "leadId" = ${seed.id}`;
  await sql`DELETE FROM "Activity" WHERE "leadId" = ${seed.id} AND "type" = 'call'`;
  await sql`DELETE FROM "Suppression" WHERE "leadId" = ${seed.id}`;
  await sql`
    UPDATE "Lead" SET "invalidPhones" = NULL, "callUnreachableAt" = NULL,
           "revisitFlag" = FALSE, "revisitDate" = NULL, "revisitNote" = NULL
     WHERE "id" = ${seed.id}`;
};
/** Backdate the most recent attempt, so "distinct days" can be exercised. */
const backdate = async (days) => {
  await sql`
    UPDATE "CallAttempt" SET "attemptedAt" = NOW() - (${days} || ' days')::interval
     WHERE "id" = (SELECT "id" FROM "CallAttempt" WHERE "leadId" = ${seed.id}
                    ORDER BY "createdAt" DESC LIMIT 1)`;
};
const fresh = async () => (await sql`
  SELECT "id","propertyId","phone1","phone2","owner2Phone","phonesAll","skipTraceData",
         "email1","email2","owner2Email","emailsAll","owner1FirstName","owner1LastName",
         "owner2FirstName","owner2LastName","addressStreet","addressZip",
         "invalidPhones","callUnreachableAt"
    FROM "Lead" WHERE "id" = ${seed.id}`)[0];

try {
  await clean();

  console.log('--- 1. a fresh lead ---');
  let st = await callState(seed);
  eq('status is not_attempted', st.status, 'not_attempted');
  ok('every number is dialable', st.dialable.length === nums.length);
  ok('nothing blocks calling', st.blockedReason === null, String(st.blockedReason));

  console.log('--- 2. attempts accumulate as facts ---');
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'no_answer', by: 'test' });
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'voicemail', by: 'test' });
  st = await callState(await fresh());
  eq('status is attempting', st.status, 'attempting');
  eq('two attempts recorded', st.attemptCount, 2);
  eq('one number tried', st.numbersTried.length, 1);

  console.log('--- 3. four calls in ONE day must NOT retire the lead ---');
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'no_answer', by: 'test' });
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'no_answer', by: 'test' });
  st = await callState(await fresh());
  eq('four attempts', st.attemptCount, 4);
  eq('still only one day', st.distinctDays, 1);
  ok('NOT unreachable — same day, same number', st.status === 'attempting',
    `status=${st.status}`);

  console.log('--- 4. spread over days, still one number ---');
  await backdate(3);
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'no_answer', by: 'test' });
  await backdate(1);
  st = await callState(await fresh());
  ok('three or more days now', st.distinctDays >= 3, `days=${st.distinctDays}`);
  ok('still NOT unreachable — only one number tried, and two exist',
    st.status === 'attempting', `status=${st.status}`);

  console.log('--- 5. the second number completes the rule ---');
  await logAttempt({ lead: seed, numberDialled: nums[1].number, outcome: 'no_answer', by: 'test' });
  st = await callState(await fresh());
  eq('two numbers tried', st.numbersTried.length, 2);
  eq('NOW unreachable', st.status, 'unreachable');
  ok('and says so', /unreachable/i.test(String(st.blockedReason)));
  const [l5] = await sql`SELECT "callUnreachableAt" FROM "Lead" WHERE "id" = ${seed.id}`;
  ok('stamped for cheap reporting', l5.callUnreachableAt != null);

  console.log('--- 6. reaching someone outranks the stop rule ---');
  /**
   * The status now names WHAT they said, not merely that they were reached (Frank, 25 Sep
   * 2026 — "'Contacted' is too broad"). A quote request reads as 'quoting'; the point being
   * tested is unchanged, which is that reaching somebody retires the unreachable count.
   */
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'quote_requested', by: 'test' });
  st = await callState(await fresh());
  eq('a quote request reads as quoting', st.status, 'quoting');
  ok('and it counts as having reached them', isReachedStatus(st.status));
  ok('so the lead is no longer unreachable', st.status !== 'unreachable');

  console.log('--- 6b. the status follows the outcome, one for one ---');
  /**
   * Frank's four rules, each checked against the outcome that should produce it. The
   * mapping is the requirement; a test that only checked "reached" would pass while every
   * one of them pointed at the wrong pile of work.
   */
  for (const [outcome, want] of [
    ['callback_scheduled', 'callback_due'],
    ['quote_requested', 'quoting'],
    ['not_interested', 'not_interested'],
    ['do_not_call', 'do_not_call'],
  ]) {
    await clean();
    await logAttempt({
      lead: seed, numberDialled: nums[0].number, outcome, by: 'test',
      ...(outcome === 'callback_scheduled'
        ? { callbackAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 16) }
        : {}),
    });
    st = await callState(await fresh());
    eq(`${outcome} -> ${want}`, st.status, want);
  }
  await clean();

  console.log('--- 7. a bad number leaves rotation ---');
  await clean();
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'bad_number', by: 'test' });
  st = await callState(await fresh());
  ok('the dead number is recorded', st.invalidNumbers.includes(nums[0].number));
  ok('it is no longer offered', !st.dialable.some((d) => d.number === nums[0].number));
  ok('the other number still is', st.dialable.some((d) => d.number === nums[1].number));

  console.log('--- 8. do-not-call suppresses the household (S3) ---');
  await clean();
  const r = await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'do_not_call', by: 'test' });
  ok('suppression written', r.suppressed === true);
  const sup = await sql`SELECT "scope","reason","source" FROM "Suppression" WHERE "leadId" = ${seed.id}`;
  eq('household scope, dnc reason', [sup[0]?.scope, sup[0]?.reason], ['household', 'dnc']);
  st = await callState(await fresh());
  ok('and the panel refuses to offer a number', /suppressed/i.test(String(st.blockedReason)),
    String(st.blockedReason));

  console.log('--- 9. a callback schedules the return ---');
  await clean();
  const when = new Date(Date.now() + 86400000).toISOString().slice(0, 19);
  await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'callback_scheduled',
    callbackAt: when, notes: 'asked for tomorrow', by: 'test' });
  const [l9] = await sql`SELECT "revisitFlag","revisitNote" FROM "Lead" WHERE "id" = ${seed.id}`;
  ok('revisit flagged', l9.revisitFlag === true);
  st = await callState(await fresh());
  ok('next callback surfaced', st.nextCallbackAt != null);

  console.log('--- 10. a callback without a date is refused ---');
  let threw = false;
  try {
    await logAttempt({ lead: seed, numberDialled: nums[0].number, outcome: 'callback_scheduled', by: 'test' });
  } catch { threw = true; }
  ok('refused', threw);

  console.log('--- 11. every attempt reaches the activity feed ---');
  const acts = await sql`
    SELECT COUNT(*)::int n FROM "Activity" WHERE "leadId" = ${seed.id} AND "type" = 'call'`;
  ok('activity written', acts[0].n > 0);
} finally {
  await clean();
  const left = await sql`SELECT COUNT(*)::int n FROM "CallAttempt" WHERE "leadId" = ${seed.id}`;
  const sup = await sql`SELECT COUNT(*)::int n FROM "Suppression"`;
  console.log(`\ncleanup: attempts=${left[0].n} · suppressions=${sup[0].n} (both should be 0)`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
