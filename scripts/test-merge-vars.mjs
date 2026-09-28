/**
 * The merge variables, tested (directive Sec. 3, 6.1, 6.2 · Zoya's mapping, 28 Sep 2026).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-merge-vars.mjs
 *
 * Reads only. The pure half needs no database; the last block reads the live send list so
 * the assertions are made against the rows that are actually about to be uploaded, not
 * against a fixture that agrees with me.
 *
 * -- Why this file exists ----------------------------------------------------
 * Everything here fails SILENTLY in production. A variable the template asks for and the
 * contact does not carry renders as nothing at all — no error, no bounce, no row in any log
 * — and the homeowner reads an email with a hole in it. The one that actually shipped read
 * "Hi ," to a live inbox while the platform held the name the whole time, because the copy
 * said first_name and the built-in is spelled firstName.
 *
 * So the assertions are about NAMES and about TEXT THAT STILL HAS BRACES IN IT. Both are
 * invisible to a typechecker and invisible to a human skimming a spreadsheet of 186 rows.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { mergeVarsFor, customOnly } from '@/services/mergeVars.service';
import { CTA_BY_STEP } from '@/services/campaignSegment.service';
import {
  MERGE_FIELDS, mergeFieldByName, unknownTokensIn, blockedTokensIn,
} from '@/lib/mergeFields';
import { resolveInboxCollisions } from '@/services/inboxCollision.service';
import { diffVariables } from '@/services/variableDrift.service';

let pass = 0;
const failures = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (name, actual, expected) =>
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const lead = (o = {}) => ({
  id: o.id ?? 9001,
  propertyId: o.propertyId ?? 'P9001',
  cohort: o.cohort ?? '2026-10-05',
  campaignSegment: o.campaignSegment ?? 'rated',
  // The variant and the arm are stored PER ROLE — the insured and the co-insured are dealt
  // separately, which is the whole reason the balance is counted in people, not accounts.
  insuredSubjectVariant: o.subjectVariant ?? 'A',
  coInsuredSubjectVariant: o.subjectVariant ?? 'A',
  insuredCtaArm: o.ctaArm ?? 2,
  coInsuredCtaArm: o.ctaArm ?? 2,
  owner1FirstName: 'Dana', owner1LastName: 'Whitfield',
  owner2FirstName: 'Ray', owner2LastName: 'Whitfield',
  addressStreet: '47 Augustus Dr', addressCity: 'Middletown',
  addressState: 'NJ', addressZip: '07748',
  effectiveDate: o.effectiveDate ?? '2026-10-11',
  travelersPremium: o.travelersPremium ?? 1840,
  ...o,
});

const BRACES = /\{\{|\}\}/;

console.log('\n── Names, exactly as the import maps them ──────────────────────────\n');

/**
 * Zoya's five, spelled her way. These are the ones a person maps by hand on the import
 * screen, and a rename on our side that nobody tells her about silently un-maps the column
 * — the upload still succeeds and the variable is simply never populated again.
 */
{
  const v = mergeVarsFor(lead(), 'insured', 'https://burlingtonai.com');
  for (const k of ['renewal_date', 'street_address', 'meeting_link']) {
    ok(`custom variable ${k} exists`, Object.hasOwn(v, k));
  }

  /**
   * band_low / band_high are deliberately NOT here. They are empty columns in the CSV so
   * the mapping can be built once; the service does not invent them. If somebody later
   * wires them to the CRM's lowPremium/highPremium this assertion goes red, which is the
   * entire point — that field contradicts the producer's own rating on 531 of 540 accounts.
   */
  ok('band_low is not built from the machine estimate', !Object.hasOwn(v, 'band_low'));
  ok('band_high is not built from the machine estimate', !Object.hasOwn(v, 'band_high'));

  // The platform's own two keep the platform's spelling, or the template renders nothing.
  eq('built-in firstName is spelled the platform way', v.firstName, 'Dana');
  ok('no snake_case first_name shadowing the built-in', !Object.hasOwn(v, 'first_name'));
  eq('co-insured takes owner 2', mergeVarsFor(lead(), 'coInsured').firstName, 'Ray');

  /**
   * The push sets first_name / last_name through the API's own fields. Sending them AGAIN
   * as custom variables would give the platform two things called firstName — its built-in
   * and one of ours — and nothing on either side reports a collision. It just picks one.
   *
   * The CSV keeps both columns, because a flat file has no separate fields to set them in;
   * there they are mapped by type on the import screen.
   */
  const c = customOnly(v);
  ok('the push does not resend firstName as a custom variable', !Object.hasOwn(c, 'firstName'));
  ok('the push does not resend lastName as a custom variable', !Object.hasOwn(c, 'lastName'));
  eq('and nothing else is dropped on the way', Object.keys(c).length, Object.keys(v).length - 2);
  eq('the copy variables survive', c.renewal_date, v.renewal_date);
}

console.log('\n── No value ships with a brace still in it ─────────────────────────\n');

/**
 * The bug this block was written for: CTA wording went out raw while subjects went through
 * the placeholder fill, so every booking arm carried "{{ agency_website }}/meet" as
 * literal text. A merged value is not re-scanned by the platform, so those braces do not
 * resolve on the far side — they print, in the email, to the homeowner.
 *
 * Revert the fill on ctaAt and this goes red on arm 2.
 */
{
  const site = 'https://burlingtonai.com';
  for (const arm of [1, 2]) {
    for (const seg of ['rated', 'not_rated', 'grade_b']) {
      const v = mergeVarsFor(lead({ ctaArm: arm, campaignSegment: seg, cohort: '2026-11-09' }), 'insured', site);
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'string' && BRACES.test(val)) {
          ok(`${seg}/arm${arm}: ${k} is fully resolved`, false, JSON.stringify(val));
        }
      }
    }
  }
  ok('every variable resolved when the website is known', failures.length === 0);

  const v = mergeVarsFor(lead({ ctaArm: 2 }), 'insured', site);
  eq('the booking link is the real URL', v.meeting_link, 'https://burlingtonai.com/meet');
  ok('the CTA carries the link, not the placeholder',
    v.cta_2.includes('https://burlingtonai.com/meet') && !BRACES.test(v.cta_2), v.cta_2);
  eq('a trailing slash on the website does not double up',
    mergeVarsFor(lead(), 'insured', 'https://burlingtonai.com/').meeting_link,
    'https://burlingtonai.com/meet');
}

console.log('\n── With no website, the link-bearing arms go EMPTY, not broken ─────\n');

/**
 * Frank has not supplied the website. The choice is between an empty CTA and
 * "Grab 15 minutes here: /meet".
 *
 * Empty is a gap somebody has to close before that step can send. A link to nowhere sends
 * perfectly and fails in the homeowner's browser, where nobody on this side ever sees it.
 */
{
  const v = mergeVarsFor(lead({ ctaArm: 2 }), 'insured');   // no website
  eq('meeting_link is empty, not "/meet"', v.meeting_link, '');
  eq('the booking arm is blank rather than half a link', v.cta_2, '');

  // The arms that only ask for a reply are unaffected and must still ship.
  const reply = mergeVarsFor(lead({ ctaArm: 1 }), 'insured');
  ok('the reply arm still has its wording', reply.cta_1.length > 10, reply.cta_1);
  ok('the reply arm has no braces', !BRACES.test(reply.cta_1));

  // And the blanking must be driven by the wording, not hard-coded to a step number.
  const linkArms = [];
  for (const step of [1, 2, 3]) {
    for (const arm of [1, 2]) {
      if (/agency_website/.test(CTA_BY_STEP[step][arm].wording)) linkArms.push(`${step}/${arm}`);
    }
  }
  eq('three arms in the table ask for a link', linkArms, ['2/2', '3/1', '3/2']);
}

console.log('\n── The renewal date, against the stored value ──────────────────────\n');

/**
 * A bare YYYY-MM-DD parsed with new Date() is UTC midnight; read back with local getters in
 * a zone behind UTC that is the day BEFORE. Every one of 678 accounts carried a renewal
 * date one day early, and the 19 renewing on the 1st were told the wrong month outright —
 * in the sentence Frank's copy states as fact.
 */
{
  eq('a text date is not shifted a day',
    mergeVarsFor(lead({ effectiveDate: '2026-10-01' }), 'insured').renewal_date, '2026-10-01');
  eq('and it names the right month',
    mergeVarsFor(lead({ effectiveDate: '2026-10-01' }), 'insured').month, 'October');
  eq('a Date object lands on the same day',
    mergeVarsFor(lead({ effectiveDate: new Date('2026-10-01T00:00:00') }), 'insured').renewal_date,
    '2026-10-01');
}

console.log('\n── The palette and the builder describe the same world ─────────────\n');

/**
 * The editor's chip list used to be four hand-typed entries while the builder emitted
 * twenty-three. The nineteen missing ones were real, mapped, and invisible to whoever was
 * writing the copy — so the only way to use one was to type its name from memory, and a
 * name typed from memory that is slightly wrong renders as nothing at all.
 *
 * This is the assertion that stops the two drifting again. Rename a variable in the service
 * and forget the catalogue, or add a chip for something the builder does not produce, and
 * this goes red — which is the only way either mistake gets caught before a send, because
 * neither is a type error and neither is visible in a spreadsheet of 186 rows.
 */
{
  const built = new Set(Object.keys(mergeVarsFor(lead(), 'insured', 'https://x.com')));

  /**
   * The two the CSV adds as empty columns. They are not built by the service on purpose —
   * see the header of export-send-list — but they DO exist as variables once the file is
   * imported, so the editor has to know their names or somebody types them by hand.
   */
  const csvOnly = new Set(['band_low', 'band_high']);
  const expected = new Set([...built, ...csvOnly]);

  const cataloged = new Set(MERGE_FIELDS.map((f) => f.name));

  const missing = [...expected].filter((n) => !cataloged.has(n));
  const invented = [...cataloged].filter((n) => !expected.has(n));

  eq('every variable the builder produces has a chip', missing, []);
  eq('no chip offers a variable that does not exist', invented, []);
  eq('every chip token matches its name', MERGE_FIELDS.filter((f) => f.token !== `{{${f.name}}}`), []);
  ok('the catalogue is not the old four-entry list', cataloged.size >= 20, `${cataloged.size} fields`);

  // The two that are valid-but-empty must SAY so, or they read as working.
  for (const n of ['meeting_link', 'band_low', 'band_high']) {
    ok(`${n} is flagged as not usable yet`, Boolean(mergeFieldByName(n)?.blocked));
  }
}

console.log('\n── The editor refuses a variable that does not exist ───────────────\n');

/**
 * The platform does not validate merge variables, so this check is the only one there is.
 * "Hi {{first_name}}," is the exact copy that shipped and rendered "Hi ,".
 */
{
  eq('the spelling that actually shipped is caught',
    unknownTokensIn('Hi {{first_name}}, your {{renewal_date}} is close'), ['first_name']);
  eq('a correct body passes clean',
    unknownTokensIn('Hi {{firstName}}, {{property_address}} renews {{renewal_date}}'), []);

  // Frank's copy is written both ways — {{month}} and {{ agency_website }} both appear in
  // the directive — so a validator that only knew one spelling would wave the other through.
  eq('spaces inside the braces are still the same variable',
    unknownTokensIn('{{ renewal_date }} and {{renewal_date}}'), []);
  eq('and a wrong name with spaces is still caught',
    unknownTokensIn('{{ agency_website }}/meet'), ['agency_website']);

  eq('each unknown name is reported once, not once per use',
    unknownTokensIn('{{nope}} {{nope}} {{nope}}'), ['nope']);
  eq('ordinary braces in prose are not variables', unknownTokensIn('a { b } c'), []);

  eq('an empty-today variable warns rather than blocks',
    blockedTokensIn('book here: {{meeting_link}}').map((f) => f.name), ['meeting_link']);
  eq('and a body using none of them warns about nothing',
    blockedTokensIn('Hi {{firstName}}'), []);
}

console.log('\n── One inbox, one contact ─────────────────────────────────────────\n');

/**
 * The platform keys a contact by EMAIL ADDRESS. Two of our rows on one address are one
 * contact there, holding one set of custom variables — so the second upload does not make
 * a second contact, it decides what the first one says.
 *
 * ramupedada@gmail.com is the live case: two neighbours, 3303 and 3304 Expedition St, one
 * inbox, both in C1. Uploaded as-is, one of them gets an email about the other's house
 * carrying the other's renewal date, and which one depends on row order.
 */
const c = (o) => ({
  email: o.email, renewalDate: o.renewal, role: o.role ?? 'insured',
  propertyId: String(o.prop), cohort: o.cohort ?? 'C1',
});
const read = (x) => x;

{
  const soon = c({ email: 'a@x.com', renewal: '2026-10-09', prop: 1 });
  const later = c({ email: 'a@x.com', renewal: '2026-10-11', prop: 2 });

  const r = resolveInboxCollisions([later, soon], read);
  eq('one contact survives an inbox', r.keep.length, 1);
  eq('and it is the soonest renewal', r.keep[0].propertyId, '1');
  eq('the other is held, not dropped', r.held.length, 1);
  eq('the held row knows what beat it', r.held[0].keptInstead.propertyId, '1');

  /**
   * Order independence is the entire point. The old rule was a `seen` set inside a loop
   * over a SQL result, so which of a man's two houses he heard about was decided by the
   * query plan — and changed when it changed. Feed the same two rows both ways round.
   */
  const flipped = resolveInboxCollisions([soon, later], read);
  eq('the same two rows resolve the same way whichever order they arrive in',
    flipped.keep[0].propertyId, r.keep[0].propertyId);

  // Identical renewal dates must still be decided, and decided the same way twice.
  const tieA = c({ email: 'b@x.com', renewal: '2026-10-09', prop: 7, role: 'coInsured' });
  const tieB = c({ email: 'b@x.com', renewal: '2026-10-09', prop: 4, role: 'insured' });
  eq('a tie goes to the insured — the policy is in their name',
    resolveInboxCollisions([tieA, tieB], read).keep[0].propertyId, '4');
  eq('and the tiebreak does not depend on order',
    resolveInboxCollisions([tieB, tieA], read).keep[0].propertyId, '4');
}

{
  /**
   * ── A later cohort is NOT a reprieve, and saying so was my mistake ──────────
   *
   * The first version treated a held row in a later cohort as safe — "held for its own
   * cohort C7" — as though it would be mailed in November. It will not be. Everything here
   * is inside ONE upload, and the platform keeps one contact per address per upload, so a
   * C7 row held out of a C4–C7 file is a house that never gets written to. Both Gandhi
   * properties are exactly that: C4 and C7, one campaign.
   *
   * The C4–C7 export is what caught it, which is why these assertions are written from the
   * real cohorts rather than from convenient ones.
   */
  const c4 = c({ email: 'g@x.com', renewal: '2026-10-31', prop: 10, cohort: 'C4' });
  const c7 = c({ email: 'g@x.com', renewal: '2026-11-19', prop: 11, cohort: 'C7' });
  const spread = resolveInboxCollisions([c4, c7], read);

  ok('the later cohort is recorded as a fact', spread.held[0].laterCohort);
  eq('but the house still counts as unmailed', spread.needsDecision.length, 1);
  ok('and the reason says so outright',
    /NOT mailed by this upload/.test(spread.held[0].reason), spread.held[0].reason);
  ok('while naming the only thing that would fix it',
    /own campaign/.test(spread.held[0].reason), spread.held[0].reason);

  const same = resolveInboxCollisions([
    c({ email: 'n@x.com', renewal: '2026-10-09', prop: 20, cohort: 'C1' }),
    c({ email: 'n@x.com', renewal: '2026-10-11', prop: 21, cohort: 'C1' }),
  ], read);
  ok('one cohort is not a later cohort', !same.held[0].laterCohort);
  eq('and it needs a decision just the same', same.needsDecision.length, 1);
  ok('in words that say waiting will not help',
    /waiting cannot separate/.test(same.needsDecision[0].reason), same.needsDecision[0].reason);
}

{
  // Both people of one household on one inbox is a different thing: nothing is lost by
  // sending once, so it must not be reported as a property going unmailed.
  const household = resolveInboxCollisions([
    c({ email: 'h@x.com', renewal: '2026-10-09', prop: 30, role: 'insured' }),
    c({ email: 'h@x.com', renewal: '2026-10-09', prop: 30, role: 'coInsured' }),
  ], read);
  eq('one email per household', household.keep.length, 1);
  eq('the insured keeps the inbox', household.keep[0].role, 'insured');
  ok('and it needs no decision', household.needsDecision.length === 0);

  // The ordinary case must not be disturbed by any of this.
  const clean = resolveInboxCollisions([
    c({ email: 'p@x.com', renewal: '2026-10-09', prop: 40 }),
    c({ email: 'q@x.com', renewal: '2026-10-09', prop: 41 }),
  ], read);
  eq('distinct inboxes are all kept', clean.keep.length, 2);
  eq('with no collisions reported', clean.collisions, 0);

  // Case and whitespace are not a different inbox.
  const messy = resolveInboxCollisions([
    c({ email: 'Mixed@X.com ', renewal: '2026-10-09', prop: 50 }),
    c({ email: 'mixed@x.com', renewal: '2026-10-11', prop: 51 }),
  ], read);
  eq('case and spacing do not make a second inbox', messy.keep.length, 1);
}

console.log('\n── Drift: what the platform holds vs what the CRM says ────────────\n');

/**
 * Merge variables are written when a contact is CREATED and never again, so everything a
 * contact carries is frozen at upload time while the card behind it keeps moving.
 *
 * Pointed at production this found that all 378 C4–C7 contacts were uploaded before the
 * 28 Sep rename: they hold renewalDate, subject1, streetAddress and six spreadsheet column
 * headings, and carry none of the snake_case names the copy now asks for. Activating that
 * campaign would have sent 378 emails with every merged value blank, and nothing in the
 * system would have said a word.
 */
{
  // A contact uploaded before the rename: the value is there, under the old name.
  const preRename = diffVariables(
    { renewal_date: '2026-10-27', street_address: '803 Madaline Dr' },
    { renewalDate: '2026-10-27', streetAddress: '803 Madaline Dr' },
  );
  const kinds = Object.fromEntries(preRename.diffs.map((d) => [d.name, d.kind]));
  eq('the new name is reported missing', kinds.renewal_date, 'missing');
  eq('and the old name is reported as an orphan', kinds.renewalDate, 'orphan');
  ok('both halves are told, not just one', preRename.diffs.length === 4, JSON.stringify(kinds));

  /**
   * That pairing is the point. "renewal_date is missing" on its own looks like a data
   * problem — a card without a renewal date. Seeing renewalDate sitting there holding the
   * same value is what says "this is a rename nobody re-uploaded for".
   */
  const orphanValue = preRename.diffs.find((d) => d.name === 'renewalDate')?.actual;
  eq('and the orphan still shows what it is holding', orphanValue, '2026-10-27');

  // A value that changed on the card after upload renders the OLD one, which is worse than
  // blank: nothing looks wrong at either end.
  const changed = diffVariables({ renewal_date: '2026-11-02' }, { renewal_date: '2026-10-27' });
  eq('a corrected date is stale, not missing', changed.diffs[0].kind, 'stale');
  eq('and the report carries both sides', [changed.diffs[0].actual, changed.diffs[0].expected],
    ['2026-10-27', '2026-11-02']);

  // The ordinary case must be silent, or nobody reads the report.
  eq('a contact that agrees produces nothing',
    diffVariables({ town: 'Avenel', month: 'October' }, { town: 'Avenel', month: 'October' }).diffs, []);

  /**
   * The platform mixes its own bookkeeping into the same map. Comparing `campaign` would
   * report drift on every contact forever, for something we neither set nor can change.
   */
  eq('the platform\'s own keys are not drift',
    diffVariables({ town: 'Avenel' }, { town: 'Avenel', campaign: 'abc', personalization: '', website: '' }).diffs, []);

  /**
   * Both sides empty is agreement, not drift — there was a `pending` kind for this at first
   * and it could never fire, because an empty value equals an empty value. What is worth
   * saying is that a BLOCKED variable agrees on nothing, so "no drift" does not get read as
   * "ready to send".
   */
  const empty = diffVariables({ meeting_link: '', town: 'Avenel' }, { town: 'Avenel' });
  eq('an empty blocked variable is not reported as drift', empty.diffs, []);
  eq('it is reported as waiting instead', empty.waiting, ['meeting_link']);

  const emptyOrdinary = diffVariables({ month: '' }, {});
  eq('an ordinary empty variable is neither drift nor waiting',
    [emptyOrdinary.diffs.length, emptyOrdinary.waiting.length], [0, 0]);

  // The bug that shipped: a name rendering as nothing while the value sat right there.
  const hi = diffVariables({ firstName: 'Abdullah' }, { first_name: 'Abdullah' });
  eq('"Hi ," is caught from both ends',
    hi.diffs.map((d) => `${d.name}:${d.kind}`).sort(), ['firstName:missing', 'first_name:orphan']);
}

console.log('\n── Against the live send list ──────────────────────────────────────\n');

/**
 * The rows above are mine, so they agree with me. These are the ones about to be uploaded.
 */
{
  const leads = await sql`
    SELECT * FROM "Lead"
     WHERE "sendListBuiltAt" IS NOT NULL AND "cohort" BETWEEN '2026-10-05' AND '2026-10-19'`;

  let rows = 0, braced = 0, noRenewal = 0, noName = 0;
  const bracedExamples = [];
  for (const l of leads) {
    for (const role of ['insured', 'coInsured']) {
      const v = mergeVarsFor(l, role);
      if (!v.firstName) continue;
      rows++;
      if (!v.renewal_date) noRenewal++;
      if (!v.lastName) noName++;
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'string' && BRACES.test(val)) {
          braced++;
          if (bracedExamples.length < 3) bracedExamples.push(`${k}=${val}`);
        }
      }
    }
  }

  console.log(`  ${rows} C1–C3 contacts built from the live rows`);
  ok('the send list is not empty', rows > 0, `rows=${rows}`);
  ok('no live contact carries an unresolved placeholder', braced === 0,
    `${braced} values, e.g. ${bracedExamples.join(' | ')}`);
  ok('every live contact has a renewal date', noRenewal === 0, `${noRenewal} without one`);
  ok('every live contact has a surname', noName === 0, `${noName} without one`);
}

console.log(`\n${failures.length ? 'FAILED' : 'PASSED'} — ${pass} assertions, ${failures.length} failures`);
if (failures.length) { for (const f of failures) console.log(`  · ${f}`); process.exit(1); }
