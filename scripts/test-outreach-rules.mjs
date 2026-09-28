/**
 * The outreach rules, tested (directive Sec. 4.1, 7.1, 11.2, 12 · S2).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-outreach-rules.mjs
 *
 * Two halves. The pure half needs no database and asserts the rules themselves. The
 * integration half writes to the live database and removes everything it wrote — it runs
 * under a unique marker so the cleanup can never touch anything real.
 *
 * Written adversarially on purpose. A test that only checks the happy path would have
 * passed on the version of normaliseStreet that silently merged five condo units into one
 * household, because that version reconciled perfectly while deleting four prospects.
 * The cases that matter here are the ones where a rule could be wrong in the expensive
 * direction: a household that was told to stop and gets mailed anyway, a live address
 * dropped as a duplicate, a dead mailbox taking a working one down with it.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import {
  normaliseStreet, addressKeyOf, groupHouseholds, householdKeyOf, householdScopeKey,
} from '@/services/household.service';
import {
  contactabilityOf, householdReach, channelOf, isDirectMailOnly, breakdown,
} from '@/services/contactability.service';
import {
  scopeForReason, isExplicitStopReply, suppress, suppressionFor,
  loadActiveSuppressions, confirmAddress, release,
} from '@/services/suppression.service';
import { buildSendList } from '@/services/sendList.service';

const MARKER = `test-rules-${globalThis.crypto.randomUUID().slice(0, 8)}`;
let pass = 0;
const failures = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (name, actual, expected) =>
  ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const lead = (o) => ({
  id: o.id, propertyId: o.id, cohort: o.cohort ?? '2026-10-05',
  addressStreet: o.street ?? '1 Test St', addressZip: o.zip ?? '07728',
  owner1FirstName: o.f ?? 'Test', owner1LastName: o.l ?? 'Owner',
  owner2FirstName: o.cf ?? null, owner2LastName: o.cl ?? null,
  email1: o.e1 ?? null, email2: o.e2 ?? null, owner2Email: o.coEmail ?? null,
  phone1: o.p1 ?? null, phone2: null, owner2Phone: o.coPhone ?? null,
  emailsAll: o.emailsAll ?? null, phonesAll: null, skipTraceData: o.trace ?? null,
  confirmedEmail: o.confirmed ?? null, confirmedRole: o.confirmedRole ?? null,
});

console.log('\n=== 1. Address normalisation — the condo trap ===');
eq('unit is kept', normaliseStreet('100 Leary Blvd Unit 329'), '100 leary blvd unit 329');
ok('different units stay apart',
  normaliseStreet('100 Leary Blvd Unit 329') !== normaliseStreet('100 Leary Blvd Unit 411'));
ok('apt and unit are the same marker',
  normaliseStreet('100 Leary Blvd Unit 329') === normaliseStreet('100 Leary Boulevard Apt 329'));
ok('# is a unit marker', normaliseStreet('5 Oak Ave #3') === normaliseStreet('5 Oak Avenue Unit 3'));
ok('# units stay apart', normaliseStreet('5 Oak Ave #3') !== normaliseStreet('5 Oak Ave #4'));
ok('suffixes fold', normaliseStreet('12 Main Street') === normaliseStreet('12 Main St'));
ok('trailing dot folds', normaliseStreet('7 Elm Rd.') === normaliseStreet('7 Elm Road'));
ok('case folds', normaliseStreet('9 HIGH ST') === normaliseStreet('9 high st'));
eq('empty in, empty out', normaliseStreet(null), '');
eq('no zip means no address key', addressKeyOf(lead({ id: 'x', zip: '' })), '');

console.log('\n=== 2. Household grouping ===');
{
  const units = ['329', '411', '420', '427', '428'].map((u, i) =>
    lead({ id: `condo${i}`, street: `100 Leary Blvd Unit ${u}`, zip: '08879', e1: `owner${i}@x.com` }));
  eq('five condo units are five households', groupHouseholds(units).households.length, 5);

  const couple = [
    lead({ id: 'h1', street: '4 Elm Rd', zip: '07728', e1: 'him@x.com' }),
    lead({ id: 'h2', street: '4 Elm Rd', zip: '07728', e1: 'her@x.com' }),
  ];
  eq('same property is one household', groupHouseholds(couple).households.length, 1);

  const twoHomes = [
    lead({ id: 'a1', street: '1 A St', zip: '07728', e1: 'same@x.com' }),
    lead({ id: 'a2', street: '99 B Ave', zip: '08816', e1: 'same@x.com' }),
  ];
  eq('a shared address merges across properties', groupHouseholds(twoHomes).households.length, 1);

  // A -> B by address, B -> C by email. All three must land together.
  const chain = [
    lead({ id: 'c1', street: '7 Chain Rd', zip: '07728', e1: 'one@x.com' }),
    lead({ id: 'c2', street: '7 Chain Rd', zip: '07728', e1: 'two@x.com' }),
    lead({ id: 'c3', street: '55 Far Ln', zip: '08816', e1: 'two@x.com' }),
  ];
  eq('merging is transitive', groupHouseholds(chain).households.length, 1);

  const strangers = [
    lead({ id: 's1', street: '1 A St', zip: '07728', e1: 'p1@x.com' }),
    lead({ id: 's2', street: '2 B St', zip: '07728', e1: 'p2@x.com' }),
  ];
  eq('unrelated leads stay apart', groupHouseholds(strangers).households.length, 2);

  const noAddr = [lead({ id: 'n1', street: '', zip: '' }), lead({ id: 'n2', street: '', zip: '' })];
  eq('address-less leads do not all collapse together', groupHouseholds(noAddr).households.length, 2);
  ok('address-less household key falls back to the lead',
    householdKeyOf(lead({ id: 'n1', street: '', zip: '' })) === 'hh:lead:n1');
}

console.log('\n=== 3. contactability (Sec. 4.1) ===');
{
  const both = lead({ id: 'b', e1: 'a@x.com', p1: '7325551234' });
  const eOnly = lead({ id: 'e', e1: 'a@x.com' });
  const pOnly = lead({ id: 'p', p1: '7325551234' });
  const none = lead({ id: 'n' });
  const coOnly = lead({ id: 'c', cf: 'Jane', cl: 'Doe', coEmail: 'jane@x.com', coPhone: '7325559999' });

  eq('email + phone', contactabilityOf(both), 'email_and_phone');
  eq('email only', contactabilityOf(eOnly), 'email_only');
  eq('phone only', contactabilityOf(pOnly), 'phone_only');
  eq('neither', contactabilityOf(none), 'none');
  eq('co-insured does not count as insured reach', contactabilityOf(coOnly), 'none');
  eq('but the household can be reached', householdReach(coOnly), 'email_and_phone');
  ok('so it is NOT direct-mail-only', isDirectMailOnly(coOnly) === false);
  ok('a lead with nothing anywhere IS direct-mail-only', isDirectMailOnly(none) === true);
  eq('channel: email', channelOf(both), 'email');
  eq('channel: phone', channelOf(pOnly), 'phone');
  eq('channel: mail', channelOf(none), 'mail');

  const b = breakdown([both, eOnly, pOnly, none]);
  eq('breakdown sums to the input', b.email_and_phone + b.email_only + b.phone_only + b.none, 4);
  eq('emailable is the E1 list', b.emailable, 2);
}

console.log('\n=== 4. Suppression scope is decided by the reason ===');
eq('unsubscribe is household', scopeForReason('unsubscribe'), 'household');
eq('complaint is household', scopeForReason('complaint'), 'household');
eq('not interested is household', scopeForReason('not_interested'), 'household');
eq('dnc is household', scopeForReason('dnc'), 'household');
eq('hard bounce is address', scopeForReason('hard_bounce'), 'address');
eq('a caller cannot widen a bounce', scopeForReason('hard_bounce', 'household'), 'address');
eq('a caller cannot narrow an opt-out', scopeForReason('unsubscribe', 'address'), 'household');
eq('manual defaults to household', scopeForReason('manual'), 'household');
eq('manual can be narrowed', scopeForReason('manual', 'address'), 'address');

console.log('\n=== 5. Explicit stop replies (Sec. 7.6) ===');
for (const t of ['STOP', 'stop - take me off your list', 'Unsubscribe', 'Please remove me from your list',
  'do not email me again', 'Not interested', 'take me off this list']) {
  ok(`stops: "${t}"`, isExplicitStopReply(t) === true);
}
for (const t of ['Sure, what would it cost?', 'stop sending me the condo one, just the house',
  'I am not interested in bundling but the home quote sounds good', 'Can you stop by Thursday?',
  'My neighbour said to remove the old policy first', '', null]) {
  ok(`does NOT stop: "${String(t).slice(0, 44)}"`, isExplicitStopReply(t) === false);
}

console.log('\n=== 6. Send-list rules (Sec. 7.1) ===');
{
  const base = [
    lead({ id: 'L1', street: '1 Send St', zip: '07728', e1: 'ins1@x.com', p1: '7325550001',
      cf: 'Jane', cl: 'Doe', coEmail: 'co1@x.com' }),
  ];
  /**
   * ── Frank, 28 Sep 2026, overturned the old rule ─────────────────────────
   *
   * These three assertions used to read "E1 mails the insured only", "one household gets
   * one E1" and "the other is excluded as a household duplicate". All three were correct
   * until he answered the question directly:
   *
   *   "We are to be sending individual and personal emails regardless of same household...
   *    the whole premise of insured and co-insured outreach is predicated on it being the
   *    first time someone within that household is seeing our message."
   *
   *   "Individual emails sent to each of the insured's verified emails — we are not sure
   *    which will be primary so we must outreach all."
   *
   * What replaces them asserts the rule that still holds, and it is the one that matters:
   * no ADDRESS is ever written to twice. Two people at one household each get their own
   * email; one person never gets two.
   */
  const e1 = await buildSendList(base, 'E1');
  eq('the co-insured is mailed from E1, not held back to E2',
    e1.recipients.map((r) => r.email).sort(), ['co1@x.com', 'ins1@x.com']);
  const e2 = await buildSendList(base, 'E2');
  eq('E2 covers the same people', e2.recipients.map((r) => r.email).sort(), ['co1@x.com', 'ins1@x.com']);

  // Every verified address for a person, not just the first.
  const manyAddrs = [lead({ id: 'M1', street: '9 Many Rd', zip: '07728',
    e1: 'a@x.com', e2: 'b@x.com', cf: 'Ann', cl: 'Roe', coEmail: 'c@x.com' })];
  const many = await buildSendList(manyAddrs, 'E1');
  ok('every address on the card is used, not only the first',
    many.recipients.length >= 3, JSON.stringify(many.recipients.map((r) => r.email)));
  eq('and no address appears twice',
    many.recipients.length, new Set(many.recipients.map((r) => r.email)).size);

  const confirmedLead = [lead({ id: 'L2', street: '2 Send St', zip: '07728', e1: 'ins2@x.com',
    cf: 'Jo', cl: 'Doe', coEmail: 'co2@x.com', confirmed: 'co2@x.com', confirmedRole: 'co_insured' })];
  const c = await buildSendList(confirmedLead, 'E2');
  eq('a confirmed address is the only one used', c.recipients.map((r) => r.email), ['co2@x.com']);
  eq('and it carries the role that engaged', c.recipients[0].role, 'co_insured');

  const sameHouse = [
    lead({ id: 'D1', street: '3 Dup Rd', zip: '07728', e1: 'him@x.com' }),
    lead({ id: 'D2', street: '3 Dup Rd', zip: '07728', e1: 'her@x.com' }),
  ];
  const d = await buildSendList(sameHouse, 'E1');
  /**
   * Two people at one address are two people. A homeowner with two renewals hearing about
   * only one of them is a missed renewal, not politeness.
   */
  eq('both people at one household are mailed', d.recipients.length, 2);
  eq('neither is dropped as a household duplicate',
    d.exclusions.filter((x) => x.reason === 'duplicate_household').length, 0);
  eq('and they are different addresses',
    new Set(d.recipients.map((r) => r.email)).size, 2);

  const noEmail = [lead({ id: 'N1', street: '4 None Rd', zip: '07728', p1: '7325550002' })];
  const n = await buildSendList(noEmail, 'E1');
  eq('phone-only is excluded from E1, not mailed', n.recipients.length, 0);
  eq('and the reason is recorded', n.exclusions[0].reason, 'no_insured_email');

  const mixed = [...base, ...sameHouse, ...noEmail, ...confirmedLead];
  const m = await buildSendList(mixed, 'E1');
  ok('every lead is mailed or excluded, never both, never neither', m.reconciles === true);
}

console.log('\n=== 7. Suppression against the live table (marked, then removed) ===');
{
  const [seed] = await sql`
    SELECT "id","propertyId","addressStreet","addressZip","email1","confirmedEmail","confirmedVia","householdId"
      FROM "Lead"
     WHERE COALESCE("manualGrade","grade")='A' AND "email1" IS NOT NULL AND "email1" <> ''
       AND "addressStreet" IS NOT NULL AND "addressZip" IS NOT NULL
     ORDER BY "id" LIMIT 1`;
  if (!seed) throw new Error('no Grade A lead with an email to test against');
  const addr = seed.email1.toLowerCase();

  try {
    await suppress({ lead: seed, email: addr, reason: 'hard_bounce', source: MARKER });
    const hit1 = await suppressionFor(seed, addr);
    eq('a hard bounce is found at address scope', hit1?.scope, 'address');

    const other = 'someone-else@example.com';
    ok('and does not touch another address in the household',
      (await suppressionFor(seed, other)) === null);

    await suppress({ lead: seed, email: addr, reason: 'unsubscribe', source: MARKER });
    const hit2 = await suppressionFor(seed, other);
    eq('an opt-out reaches every address in the household', hit2?.scope, 'household');

    const dup = await suppress({ lead: seed, email: addr, reason: 'unsubscribe', source: MARKER });
    ok('re-suppressing the same thing writes nothing', dup.created === false);

    const active = await loadActiveSuppressions();
    ok('bulk load sees the address', active.emails.has(addr));
    // The STORED household id since migration 034. householdKeyOf is the address-derived
    // string it replaced, and no reader asks for that any more.
    ok('bulk load sees the household', active.households.has(householdScopeKey(seed)));

    await confirmAddress({ leadId: seed.id, email: addr, via: 'reply', role: 'insured' });
    const [after] = await sql`SELECT "confirmedEmail","confirmedVia" FROM "Lead" WHERE "id" = ${seed.id}`;
    eq('engagement confirms the address', after.confirmedEmail, addr);
    eq('and records how', after.confirmedVia, 'reply');

    // The rule that matters most: a suppressed household is not rescued by a confirmed
    // address. Somebody who replied and later opted out has opted out.
    const list = await buildSendList([{ ...seed, confirmedEmail: addr, cohort: '2026-10-05' }], 'E1');
    eq('household suppression beats a confirmed address', list.recipients.length, 0);
    eq('and says why', list.exclusions[0]?.reason, 'suppressed_household');

    const [row] = await sql`
      SELECT "id" FROM "Suppression" WHERE "source" = ${MARKER} AND "reason" = 'unsubscribe' LIMIT 1`;
    await release(row.id, 'test', 'released by the test suite');
    ok('a released suppression stops applying',
      (await suppressionFor(seed, other)) === null);
    const [rel] = await sql`SELECT "releasedAt" FROM "Suppression" WHERE "id" = ${row.id}`;
    ok('but the record survives — it is never deleted', rel.releasedAt != null);
  } finally {
    const del = await sql`DELETE FROM "Suppression" WHERE "source" = ${MARKER} RETURNING "id"`;
    await sql`
      UPDATE "Lead" SET "confirmedEmail" = ${seed.confirmedEmail}, "confirmedVia" = ${seed.confirmedVia},
             "confirmedAt" = NULL, "confirmedRole" = NULL
       WHERE "id" = ${seed.id}`;
    console.log(`  (removed ${del.length} test suppressions, restored lead ${seed.id})`);
  }
}

console.log('\n=== 8. The real send list still reconciles ===');
{
  const { loadCandidates } = await import('@/services/sendList.service');
  const all = await loadCandidates('2026-10-05', '2026-11-22');
  const live = await buildSendList(all, 'E1');
  ok('every Grade A lead is accounted for', live.reconciles === true,
    `${live.counts.recipients} mailed, ${live.exclusions.length} exclusion rows, ${all.length} considered`);
  ok('nobody is mailed twice at the same address',
    new Set(live.recipients.map((r) => r.email)).size === live.recipients.length);
  /**
   * A household CAN appear more than once now — that is Frank's 28 Sep instruction, and
   * this assertion used to forbid it. What must still hold is the address rule above: two
   * people at one household get one email each, and nobody gets two.
   *
   * Checked as a ceiling rather than dropped: a household appearing more times than it has
   * distinct addresses would mean the same person was on the list twice under two keys, and
   * nothing else would catch that.
   */
  const perHousehold = new Map();
  for (const r of live.recipients) {
    if (!perHousehold.has(r.householdKey)) perHousehold.set(r.householdKey, new Set());
    perHousehold.get(r.householdKey).add(r.email);
  }
  const overfull = [...perHousehold.entries()].filter(([, s]) => s.size > 6);
  ok('no household is mailed at more than six addresses', overfull.length === 0,
    overfull.slice(0, 3).map(([k, s]) => `${k}: ${s.size}`).join(', '));
  console.log(`  (households mailed at more than one address: ${[...perHousehold.values()].filter((s) => s.size > 1).length})`);
  console.log(`  (live list: ${live.counts.recipients} recipients across ${live.counts.households} households)`);

  /**
   * ── The surname hold reaches the export, not just the push ───────────────
   *
   * Frank §7: "Failures go to a review list, not into a send." A send list IS a send — it
   * is the file somebody uploads to the platform.
   *
   * This was false until 28 Sep 2026. The push had honoured the hold since it was written
   * and the list had not, so the same cohort meant two different things depending on which
   * door it left by: 40 held addresses on C1–C3 and 209 on C4–C7 were being exported for
   * sending that the push refused. Nothing failed, because nothing compared the two.
   */
  const { heldAddresses } = await import('@/services/emailNameReview.service');
  const onHold = await heldAddresses();
  const leaked = live.recipients.filter((r) => onHold.has(r.email.toLowerCase()));
  ok('no address awaiting surname review is on the send list', leaked.length === 0,
    leaked.slice(0, 3).map((r) => r.email).join(', '));
  console.log(`  (addresses held for review, correctly withheld: ${onHold.size})`);

  /**
   * And the two doors agree, which is the assertion the above is a special case of.
   *
   * Cheap to state and it is the one that would have caught the defect on the day it was
   * introduced: anything the list offers, the push must also offer.
   */
  const { triagePush } = await import('@/services/campaignPush.service');
  const { listCampaigns } = await import('@/lib/integrations/leadCampaign');
  const campaigns = await listCampaigns().catch(() => []);
  if (campaigns.length) {
    const t = await triagePush(campaigns[0].id,
      { grade: 'A', effectiveDate: '2026-10-05', effectiveTo: '2026-11-22' }, { recipients: 'both' });
    const pushed = new Set(t.eligible.map((r) => r.email.toLowerCase()));
    const onlyList = live.recipients.filter((r) => !pushed.has(r.email.toLowerCase()));
    ok('the export and the push offer the same addresses', onlyList.length === 0,
      `${onlyList.length} on the list only, e.g. ${onlyList.slice(0, 3).map((r) => r.email).join(', ')}`);
  } else {
    console.log('  (skipped the export-vs-push check: no campaign to triage against)');
  }
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  · ${f}`); process.exit(1); }
