/**
 * The Sec 10.7 outreach dashboard — is the funnel internally honest?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-outreach-dashboard.mjs
 *
 * Reads only. Writes nothing and calls no vendor.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * A funnel is a set of claims about denominators, and every wrong rate this project has
 * shipped came from dividing by the wrong one — Frank's discrepancy D2 is literally the
 * same count reported as 61% and 81%. Those bugs are invisible by inspection: the screen
 * renders, the number looks plausible, and nobody can tell without recomputing it.
 *
 * So this asserts the structure rather than the values: that each rung divides by the rung
 * it names, that the ladder narrows, that nothing claims to be measured before it can be,
 * and that the per-cohort rows add up to the totals. Those hold whatever the data does,
 * which is what makes them worth running after every change.
 */
import './lib/env.mjs';
import { getOutreachDashboard } from '@/services/outreachDashboard.service';
import { getCohortLedger } from '@/services/cohortLedger.service';
import { computeMetrics } from '@/services/protectiveMetrics.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, a === b, `got ${a}, want ${b}`);

const d = await getOutreachDashboard({});
const stage = (k) => d.funnel.find((s) => s.key === k);
const rail = (k) => d.guardrails.find((g) => g.key === k);

console.log(`outreach started: ${d.outreachStarted}`);
console.log('funnel:');
for (const s of d.funnel) {
  const of = d.funnel.find((x) => x.key === s.of);
  console.log(`   ${s.label.padEnd(30)} ${String(s.count).padStart(6)}` +
    `${!s.started ? '   (not started)' : s.rate == null ? '' : `  ${String(s.rate).padStart(5)}% of ${of?.label ?? ''}`}` +
    `${s.target != null ? `  [target ${s.target}%${s.floor != null ? `, floor ${s.floor}%` : ''}]` : ''}`);
}

console.log('\n--- 1. the ladder is well formed ---');
ok('every stage names a real denominator (or none)',
  d.funnel.every((s) => s.of === null || d.funnel.some((x) => x.key === s.of)),
  d.funnel.filter((s) => s.of && !d.funnel.some((x) => x.key === s.of)).map((s) => s.key).join(','));
ok('only the top rung has no denominator',
  d.funnel.filter((s) => s.of === null).length === 1);
/**
 * Each rung's denominator must be ABOVE it. A rung measured against something below it
 * reads as a rate and is an inversion — the shape of D2.
 */
ok('every denominator sits above its stage', d.funnel.every((s, i) =>
  s.of === null || d.funnel.findIndex((x) => x.key === s.of) < i));

console.log('--- 2. the rates are the counts ---');
/** Recompute every published rate from the two published counts. */
let rateDrift = 0;
for (const s of d.funnel) {
  if (!s.started || s.rate == null || s.of === null) continue;
  const den = stage(s.of);
  if (!den || den.count === 0) continue;
  const want = Math.round((s.count / den.count) * 1000) / 10;
  if (Math.abs(want - s.rate) > 0.05) {
    rateDrift++;
    console.log(`     ${s.key}: published ${s.rate}%, but ${s.count}/${den.count} = ${want}%`);
  }
}
eq('every published rate equals count ÷ its own denominator', rateDrift, 0);

console.log('--- 3. the funnel narrows ---');
/**
 * Counts must not grow going down. "verified" is exempt: no verifier is chosen yet
 * (register A25), so it is reported as 0 and not started rather than as a real count.
 */
const measured = d.funnel.filter((s) => s.started);
let widened = 0;
for (let i = 1; i < measured.length; i++) {
  if (measured[i].count > measured[i - 1].count) {
    widened++;
    console.log(`     ${measured[i].key} (${measured[i].count}) > ${measured[i - 1].key} (${measured[i - 1].count})`);
  }
}
eq('no measured stage is wider than the one above it', widened, 0);

console.log('--- 4. nothing claims to be measured before it can be ---');
ok('the unmeasurable verifier stage is not started', stage('verified').started === false);
ok('...and reports no rate', stage('verified').rate === null);
ok('inbox placement has no automatic value', rail('inbox').value === null && rail('inbox').started === false);
/**
 * The complaint rate is meaningless on a small denominator, and §08 sets the floor rather
 * than this screen: minVolumeFor(0.3) is 334 SENDS, not the 300 delivered this dashboard
 * used to assume. The two nearly agree, which is exactly why the wrong one survived — with
 * nothing sent both are false and the assertion passed on a rule that no longer exists.
 *
 * So assert the rule that is actually enforced: a rate needs sends behind it, and the
 * breach flag is the service's to set.
 */
ok('the complaint rate is reported only once something has been sent',
  rail('complaints').started === (rail('complaints').value != null));
ok('nothing has breached while nothing has been sent',
  d.outreachStarted || d.guardrails.every((g) => !g.breached),
  d.guardrails.filter((g) => g.breached).map((g) => g.key).join(','));
if (!d.outreachStarted) {
  ok('with nothing sent, no send-side stage claims to have started',
    ['emailed', 'delivered', 'engaged'].every((k) => stage(k).started === false));
  ok('...and none of them publishes a rate',
    ['emailed', 'delivered', 'engaged'].every((k) => stage(k).rate === null || stage(k).count === 0));
}

console.log('--- 5. quotes and binds share a population ---');
/**
 * The defect this guards: binds counted over every card while quotes were counted over
 * current-Grade-A only. One downgrade of a quoted card then puts bound above quoted and
 * the close rate above 100%.
 */
ok('bound never exceeds quoted', stage('bound').count <= stage('quoted').count,
  `bound ${stage('bound').count} vs quoted ${stage('quoted').count}`);
ok('the close rate is not above 100%',
  stage('bound').rate == null || stage('bound').rate <= 100, String(stage('bound').rate));

console.log('--- 6. the weeks add up to the totals ---');
const sum = (k) => d.byCohort.reduce((a, r) => a + r[k], 0);
eq('Grade A at pull sums across cohorts', sum('atPull'), stage('at_pull').count);
eq('worked sums across cohorts', sum('worked'), stage('worked').count);
eq('cards with an insured email sum across cohorts', sum('withEmail'), stage('with_email').count);
eq('bound sums across cohorts', sum('bound'), stage('bound').count);
eq('quoted sums across cohorts', sum('quoted'), stage('quoted').count);

console.log('--- 7. it agrees with the Cohort Ledger ---');
/**
 * Two screens, one truth. The ledger is what Frank already reads; a dashboard whose top
 * number disagrees with it would recreate the exact problem it exists to solve.
 */
/**
 * The SAME range the dashboard applied. The dashboard now defaults to the outreach
 * programme window, so handing the ledger no range compares 7 weeks against 27 and fails
 * on the comparison rather than on the data.
 */
const ledger = await getCohortLedger({ effFrom: d.range.from, effTo: d.range.to });
const lAtPull = ledger.reduce((a, r) => a + r.aAtPull, 0);
const lANow = ledger.reduce((a, r) => a + r.aNow, 0);
eq('Grade A at pull matches the ledger', stage('at_pull').count, lAtPull);
eq('Grade A worked matches the ledger\'s "Grade A now"', stage('worked').count, lANow);
const lMailable = ledger.reduce((a, r) => a + r.mailable, 0);
eq('cards with an insured email match the ledger\'s mailable', stage('with_email').count, lMailable);

console.log('--- 8. guardrail shape ---');
ok('every guardrail says how it is measured', d.guardrails.every((g) => g.definition && g.definition.length > 10));
ok('every guardrail declares which way is good',
  d.guardrails.every((g) => g.direction === 'higher' || g.direction === 'lower'));
ok('guardrails that can pause a send carry the rule',
  ['inbox', 'complaints', 'engagement'].every((k) => (rail(k).pause ?? '').length > 0));
/** The two screens share these targets; a drift here means one of them is lying. */
eq('email coverage guardrail matches the funnel rung', rail('coverage').value, stage('with_email').rate);

console.log('--- 9. retention is not inflated by upgrades ---');
/**
 * The 17 Aug week was pulled with 16 Grade A and holds 39 today. If retention were
 * "Grade A now ÷ Grade A at pull" that week would score 244%, and every week's upgrades
 * would quietly pad the figure the 87% target is read against.
 */
const keptSum = d.byCohort.reduce((a, r) => a + r.kept, 0);
const gainedSum = d.byCohort.reduce((a, r) => a + r.gained, 0);
eq('kept + upgraded equals worked', keptSum + gainedSum, stage('worked').count);
ok('no week reports more kept than it pulled',
  d.byCohort.every((r) => r.kept <= r.atPull),
  d.byCohort.filter((r) => r.kept > r.atPull).map((r) => r.label).join(','));
ok('retention is measured on kept, not on worked',
  rail('kept').value === (keptSum > 0 ? Math.round((keptSum / stage('at_pull').count) * 1000) / 10 : null),
  `guardrail ${rail('kept').value}, kept ${keptSum}/${stage('at_pull').count}`);
ok('retention never exceeds 100%', rail('kept').value == null || rail('kept').value <= 100,
  String(rail('kept').value));
ok('the upgrade count is published so the difference is visible',
  rail('gained').value === gainedSum, `${rail('gained').value} vs ${gainedSum}`);
/** The worked rung must carry no target, or upgrades would be graded as retention. */
ok('the worked rung carries no target of its own', stage('worked').target === null);
if (gainedSum > 0) {
  console.log(`   ${keptSum} kept + ${gainedSum} upgraded in = ${stage('worked').count} worked` +
    `  (retention ${rail('kept').value}%, worked/pull ${stage('worked').rate}%)`);
}

console.log('--- 10. the default range is the outreach programme ---');
/**
 * Unfiltered, this screen spans back to March and reports coverage of 48.7% "below floor"
 * — true of every card ever loaded and false of the campaign. Defaulting fixes that and
 * introduces its own risk, so both halves are asserted: that the window is derived, and
 * that whatever it drops is counted and published rather than disappearing.
 */
ok('a range was defaulted', d.defaultedRange === true);
ok('...and the window says how it was derived',
  (d.window?.reason ?? '').length > 30, d.window?.reason ?? '(none)');
eq('the applied range is the window',
  `${d.range.from}..${d.range.to}`, `${d.window?.from}..${d.window?.to}`);
ok('every cohort on screen is inside the window',
  d.byCohort.every((r) => r.cohort >= d.window.from && r.cohort <= d.window.to),
  d.byCohort.filter((r) => r.cohort < d.window.from || r.cohort > d.window.to)
    .map((r) => r.cohort).join(','));

/** An explicit range must be honoured exactly, never re-defaulted. */
const explicit = await getOutreachDashboard({ effFrom: '2026-11-16', effTo: '2026-11-16' });
ok('an explicit range is not overridden', explicit.defaultedRange === false);
eq('an explicit range is used verbatim',
  `${explicit.range.from}..${explicit.range.to}`, '2026-11-16..2026-11-16');
ok('an explicit range reports no excluded weeks', explicit.excluded === null);
ok('an explicit single week returns that week only',
  explicit.byCohort.length === 1 && explicit.byCohort[0].cohort === '2026-11-16');

/**
 * Nothing may vanish. The default's totals plus what it says it excluded must reconstruct
 * the whole book — otherwise the default is hiding cards rather than scoping them.
 */
const all = await getOutreachDashboard({ allWeeks: true });
ok('all-weeks reports no defaulted range', all.defaultedRange === false);
ok('all-weeks applies no range at all', all.range.from === null && all.range.to === null);
const allWorked = all.funnel.find((x) => x.key === 'worked').count;
const allEmail = all.funnel.find((x) => x.key === 'with_email').count;
eq('default worked + excluded worked = all worked',
  stage('worked').count + (d.excluded?.worked ?? 0), allWorked);
eq('default with-email + excluded with-email = all with-email',
  stage('with_email').count + (d.excluded?.withEmail ?? 0), allEmail);

console.log(`   window   ${d.window?.from} .. ${d.window?.to}`);
console.log(`   on screen ${stage('worked').count} worked, ${stage('with_email').count} with email (${stage('with_email').rate}%)`);
console.log(`   excluded  ${d.excluded?.cohorts ?? 0} week(s), ${d.excluded?.worked ?? 0} worked, ${d.excluded?.withEmail ?? 0} with email`);
console.log(`   all weeks ${allWorked} worked, ${allEmail} with email (${all.funnel.find((x) => x.key === 'with_email').rate}%)`);

console.log('--- 11. deliverability guards quote §08, they do not re-derive it ---');
/**
 * The defect this pins, which shipped and was caught by reading the code rather than the
 * screen: this dashboard computed its own bounce, complaint and unsubscribe rates with NO
 * target on any of them, and carried an inbox-placement target of 75 — which is the PAUSE
 * threshold, not the target. So a campaign sitting exactly on the line where §08 pauses
 * sending was reported here as having met its goal, and three rates that protectiveMetrics
 * enforces were rendered as "no target".
 *
 * Asserting equality against the service is the only check that survives someone editing
 * either side, because both numbers look perfectly reasonable in isolation.
 */
const metrics = await computeMetrics({ windowDays: 7 });
const mr = (k) => metrics.readings.find((r) => r.key === k);
const PAIRS = [
  ['inbox', 'inbox_placement'],
  ['hard_bounce', 'bounce_rate'],
  ['complaints', 'complaint_rate'],
  ['unsub', 'unsubscribe_rate'],
];
for (const [railKey, metricKey] of PAIRS) {
  const g = rail(railKey);
  const r = mr(metricKey);
  ok(`${railKey}: the guardrail exists`, !!g);
  ok(`${railKey}: §08 has a reading for it`, !!r);
  if (!g || !r) continue;
  eq(`${railKey}: value matches §08`, g.value, r.value);
  eq(`${railKey}: target matches §08`, g.target, r.target);
  eq(`${railKey}: pause threshold matches §08`, g.pauseAt, r.pauseAt);
  eq(`${railKey}: breach state matches §08`, g.breached, r.breached);
  eq(`${railKey}: attention note matches §08`, g.needsAttention, r.needsAttention);
  ok(`${railKey}: says what period it covers`, (g.scope ?? '').length > 5, g.scope);
}

/**
 * The specific confusion, named. Inbox placement targets 80 and pauses below 75; if those
 * two are ever equal, someone has folded the pause line back into the target.
 */
eq('inbox placement targets 80', rail('inbox').target, 80);
eq('inbox placement pauses below 75', rail('inbox').pauseAt, 75);
ok('the target and the pause line are not the same number',
  rail('inbox').target !== rail('inbox').pauseAt);

/** No reading is not a pass — §02 makes placement a gate on sending at all. */
if (rail('inbox').value == null) {
  ok('with no seed test, placement is not reported as started', rail('inbox').started === false);
  ok('...and it says so rather than sitting silent',
    (rail('inbox').needsAttention ?? '').length > 10, rail('inbox').needsAttention ?? '(none)');
  console.log(`   placement: ${rail('inbox').needsAttention}`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
