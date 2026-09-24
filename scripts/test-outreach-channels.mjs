/**
 * The per-channel half of Sec 10.7 — are the funnels honest before anything has run?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-outreach-channels.mjs
 *
 * Reads only. Writes nothing and calls no vendor.
 *
 * -- Why this suite exists ---------------------------------------------------
 * Every one of these sections is currently empty: nothing has been emailed, one call has
 * been logged, nothing quoted or bound. That is exactly when a dashboard is most likely to
 * ship wrong, because every number is zero and zero looks right whatever the code does.
 *
 * So this asserts the SHAPE: that each rung divides by the rung it names, that an empty
 * channel says "not started" instead of reporting 0%, that a figure needing a setting
 * nobody has set is null rather than zero, and that the headline metric is premium rather
 * than a count of binds -- which is what it was before the section text was read.
 */
import './lib/env.mjs';
import { getOutreachChannels } from '@/services/outreachChannels.service';
import { computeMetrics } from '@/services/protectiveMetrics.service';
import { getQcReport } from '@/services/reports.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const c = await getOutreachChannels({});
const funnel = (k) => c.funnels.find((f) => f.channel === k);

for (const f of c.funnels) {
  console.log(`\n${f.label}: ${f.status}`);
  for (const r of f.rungs) {
    console.log(`   ${r.label.padEnd(18)} ${String(r.count).padStart(6)}`
      + `${r.rate == null ? '' : `  ${r.rate}% of ${f.rungs.find((x) => x.key === r.of)?.label ?? ''}`}`);
  }
  for (const e of f.extras) console.log(`   · ${e.label}: ${e.value ?? '—'}${e.value != null ? (e.suffix ?? '') : ''}`);
}

console.log('\n--- 1. all three channels exist ---');
eq('three funnels', c.funnels.length, 3);
ok('email, phone and mail are all present',
  ['email', 'phone', 'mail'].every((k) => !!funnel(k)));
ok('every funnel says what state it is in', c.funnels.every((f) => (f.status ?? '').length > 10));

console.log('--- 2. every ladder is well formed ---');
for (const f of c.funnels) {
  ok(`${f.channel}: only the top rung has no denominator`,
    f.rungs.filter((r) => r.of === null).length === 1);
  ok(`${f.channel}: every denominator names a real rung`,
    f.rungs.every((r) => r.of === null || f.rungs.some((x) => x.key === r.of)));
  /**
   * Each rung's denominator must sit ABOVE it. `lost` is the deliberate exception: 10.7
   * ends "bound / lost", two terminals sharing the `quoted` denominator, so lost points
   * sideways at the same rung bound does rather than down at bound.
   */
  ok(`${f.channel}: every denominator sits above its rung`,
    f.rungs.every((r, i) => r.of === null || f.rungs.findIndex((x) => x.key === r.of) < i));
  /** Recompute every published rate from the two published counts. */
  let drift = 0;
  for (const r of f.rungs) {
    if (r.rate == null || r.of === null) continue;
    const den = f.rungs.find((x) => x.key === r.of);
    if (!den || den.count === 0) continue;
    const want = Math.round((r.count / den.count) * 1000) / 10;
    if (Math.abs(want - r.rate) > 0.05) { drift++; console.log(`     ${f.channel}.${r.key}: ${r.rate}% vs ${want}%`); }
  }
  eq(`${f.channel}: every rate equals count over its own denominator`, drift, 0);
}

console.log('--- 3. bound and lost are terminals, not a sequence ---');
for (const f of [funnel('email'), funnel('phone')]) {
  const bound = f.rungs.find((r) => r.key === 'bound');
  const lost = f.rungs.find((r) => r.key === 'lost');
  ok(`${f.channel}: lost is measured against quoted, like bound`,
    lost.of === 'quoted' && bound.of === 'quoted', `bound of=${bound.of}, lost of=${lost.of}`);
}

console.log('--- 3b. a loss before a quote is not counted against quoted ---');
/**
 * The one loss on the book was recorded with no quotedPremium, which made the funnel read
 * "Lost 1 of Quoted 0" -- a count sitting in a denominator it was never part of. The rung
 * now counts only losses that had a quote; the rest are reported beside it.
 */
for (const f of [funnel('email'), funnel('phone')]) {
  const lost = f.rungs.find((r) => r.key === 'lost');
  const quoted = f.rungs.find((r) => r.key === 'quoted');
  ok(`${f.channel}: lost never exceeds quoted`, lost.count <= quoted.count,
    `lost ${lost.count} vs quoted ${quoted.count}`);
  const before = f.extras.find((e) => e.label === 'Lost before a quote');
  ok(`${f.channel}: losses before a quote are reported separately`, before != null);
  if (before) console.log(`   ${f.channel}: ${before.value} lost before any quote`);
}

console.log('--- 4. an empty channel says so, it does not report 0% ---');
for (const f of c.funnels) {
  if (f.started) continue;
  ok(`${f.channel}: not started, so no rung claims to have started`,
    f.rungs.every((r) => !r.started || r.count > 0));
  ok(`${f.channel}: publishes no rate while empty`,
    f.rungs.every((r) => r.rate == null || r.count > 0));
}
ok('direct mail is a placeholder, as 10.7 asks', funnel('mail').started === false);

console.log('--- 5. the phone funnel is the call report, not a second reading ---');
/**
 * The stop rule -- four attempts across three distinct days -- lives in the call_outcome
 * report and is asserted against the lead card by its own suite. If this dashboard counted
 * CallAttempt again it would be a third implementation, and the first change to the rule
 * would leave this screen quietly on the old one.
 */
const callRows = await getQcReport('call_outcome', {});
const ph = funnel('phone');
eq('assigned equals the call report row count',
  ph.rungs.find((r) => r.key === 'assigned').count, callRows.length);
eq('contacted equals the report\'s contacted leads',
  ph.rungs.find((r) => r.key === 'contacted').count,
  callRows.filter((r) => r.callStatus === 'contacted').length);
const unreachRate = ph.extras.find((e) => e.label === 'Unreachable rate');
ok('the unreachable rate is published', unreachRate != null);

console.log('--- 6. deliverability comes from the protective-metrics service ---');
const metrics = await computeMetrics({ windowDays: 7 });
eq('one row per sending mailbox', c.deliverability.length, metrics.byMailbox.length);
ok('the mailboxes are the same ones',
  c.deliverability.every((d) => metrics.byMailbox.some((m) => m.mailbox === d.mailbox)));
ok('sent counts match the service',
  c.deliverability.every((d) => metrics.byMailbox.find((m) => m.mailbox === d.mailbox)?.sent === d.sent));

console.log('--- 7. money that needs a setting is null, never zero ---');
/**
 * There is no commission field anywhere in the schema and no rate has been set. A zero
 * here would read as "we earned nothing", which is a claim; null reads as "not computed",
 * which is the truth.
 */
if (c.economics.commissionRatePct == null) {
  ok('commission rate is reported missing', c.economics.missing.includes('commission_rate_pct'));
  ok('...so no commission figure is invented',
    c.crossChannel.every((r) => r.commission === null));
  ok('...and the headline says why it cannot compute commission',
    c.headline.commissionPer1k === null && c.headline.note.length > 10, c.headline.note);
}
for (const key of ['cost_per_email_sent', 'cost_per_call_minute']) {
  if (c.economics.missing.includes(key)) {
    ok(`${key} missing means no cost-per figures are invented`,
      c.crossChannel.every((r) => r.costPerContact === null || r.costTotal !== null));
  }
}
console.log(`   settings not set: ${c.economics.missing.join(', ') || '(none)'}`);

console.log('--- 8. the headline is premium, not a count of binds ---');
/**
 * 10.7's words: "bound premium and commission per 1,000 emails sent". This screen
 * previously reported a COUNT of binds per 1,000, which is a different quantity under the
 * same name and the one Frank calls the verdict metric.
 */
ok('the headline carries emails sent', typeof c.headline.emailsSent === 'number');
if (c.headline.emailsSent === 0) {
  ok('with nothing sent, the verdict metric is null rather than zero',
    c.headline.boundPremiumPer1k === null && c.headline.commissionPer1k === null);
  ok('...and it says there is no denominator yet', /denominator|sent/i.test(c.headline.note));
}

console.log('--- 9. response time is not invented either ---');
ok('response time reports how many leads it measured', typeof c.responseTime.measured === 'number');
if (c.responseTime.measured === 0) {
  ok('nothing measured means every figure is null',
    [c.responseTime.medianMinutes, c.responseTime.meanMinutes,
      c.responseTime.slowestMinutes, c.responseTime.withinSlaPct].every((v) => v === null));
  ok('...and it says what it is waiting for', c.responseTime.note.length > 20);
}

console.log('--- 10. the cross-channel view covers every channel ---');
eq('one row per channel', c.crossChannel.length, c.funnels.length);
ok('the channels line up with the funnels',
  c.funnels.every((f) => c.crossChannel.some((r) => r.channel.toLowerCase().startsWith(f.label.toLowerCase().slice(0, 5)))));
ok('binds never exceed quotes in any channel',
  c.crossChannel.every((r) => r.binds <= r.quotes || r.quotes === 0),
  c.crossChannel.filter((r) => r.binds > r.quotes).map((r) => r.channel).join(','));

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
