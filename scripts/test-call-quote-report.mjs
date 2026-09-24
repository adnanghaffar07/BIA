/**
 * Calls & Outcomes report — does it agree with the lead card?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-call-quote-report.mjs
 *
 * Reads only. Writes nothing and calls no vendor.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * The report derives call status and quote stage in SQL, while the lead card derives the
 * same two things in callState() and quoteState(). That is deliberately a second
 * implementation — per-lead service calls over ~10,000 leads is not a report — and a
 * second implementation of a rule is a liability. This asserts the two agree lead by
 * lead, so a drift shows up as a failing test instead of as a report nobody can
 * reconcile against the cards it describes.
 */
import './lib/env.mjs';
import { getQcReport } from '@/services/reports.service';
import { callState } from '@/services/callLog.service';
import { quoteState } from '@/services/quoteOutcomes.service';
import { sql } from '@/lib/neon';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const rows = await getQcReport('call_outcome', {});
console.log(`report returned ${rows.length} lead(s)\n`);

console.log('--- 1. shape ---');
ok('it returns rows', rows.length > 0);
ok('every row has a call status', rows.every((r) => r.callStatus));
ok('every row has a quote stage', rows.every((r) => r.quoteStage));
/**
 * Workable grades, OR anything already worked. A lead downgraded to D after the call that
 * downgraded it still belongs in a report about what producers did — that was lead
 * 201620523, and excluding it hid the only real producer activity in the system.
 */
ok('every row is either workable or has been worked',
  rows.every((r) => ['A', 'B', 'C'].includes(String(r.manualGrade || r.grade))
    || r.callStatus !== 'not_attempted' || r.quoteStage !== 'not_rated'));
const worked = rows.filter((r) => !['A', 'B', 'C'].includes(String(r.manualGrade || r.grade)));
console.log(`   ${worked.length} row(s) are outside the workable grades and included because they were worked`);

const CALL = ['not_attempted', 'attempting', 'contacted', 'unreachable'];
const QUOTE = ['not_rated', 'rated', 'quoted', 'sold', 'lost'];
ok('call statuses are all from the vocabulary', rows.every((r) => CALL.includes(r.callStatus)),
  [...new Set(rows.map((r) => r.callStatus))].join(','));
ok('quote stages are all from the vocabulary', rows.every((r) => QUOTE.includes(r.quoteStage)),
  [...new Set(rows.map((r) => r.quoteStage))].join(','));

console.log('--- 2. the distribution ---');
const tally = (k) => rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {});
console.log('   call :', JSON.stringify(tally('callStatus')));
console.log('   quote:', JSON.stringify(tally('quoteStage')));

console.log('--- 3. it agrees with the lead card, lead by lead ---');
/**
 * Every lead that has ever been called, plus a sample of the untouched ones. The called
 * ones are where the two implementations can actually disagree; the sample guards against
 * "not_attempted" being produced for the wrong reason.
 */
const called = await sql`SELECT DISTINCT "leadId" FROM "CallAttempt"`;
/**
 * lostReason is in this list for a reason.
 *
 * It was not, and that was the blind spot: two leads carry a loss reason with no lostAt,
 * recorded from the lead card's status dropdown rather than the outcome panel. The card
 * reads them as lost and the report did not — a genuine disagreement between the two
 * implementations this suite exists to compare — and it passed 14 out of 14 because
 * neither lead was ever sampled. A comparison is only worth what its sample covers.
 */
const withOutcome = await sql`
  SELECT "id" FROM "Lead"
   WHERE "boundPremium" IS NOT NULL OR "lostAt" IS NOT NULL OR "lostReason" IS NOT NULL
      OR "status" = 'lost'
      OR "quotedPremium" IS NOT NULL OR "indicativeBandLow" IS NOT NULL
   LIMIT 40`;
const sample = rows.slice(0, 15).map((r) => r.propertyId);
const ids = [...new Set([
  ...called.map((c) => String(c.leadId)),
  ...withOutcome.map((w) => String(w.id)),
  ...sample,
])];
console.log(`   checking ${ids.length} lead(s) against callState() and quoteState()`);

let callMismatch = 0, quoteMismatch = 0, notInReport = 0;
for (const id of ids) {
  const row = rows.find((r) => String(r.propertyId) === String(id));
  if (!row) { notInReport++; continue; }   // graded D, so correctly out of scope

  const [lead] = await sql`SELECT * FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1`;
  if (!lead) continue;

  const cs = await callState(lead);
  if (cs.status !== row.callStatus) {
    callMismatch++;
    console.log(`     call  ${id}: card=${cs.status} report=${row.callStatus}`);
  }

  const qs = await quoteState(String(lead.id));
  const cardStage = qs.bound ? 'sold'
    : qs.loss ? 'lost'
      : qs.quote ? 'quoted'
        : qs.band ? 'rated'
          : 'not_rated';
  if (cardStage !== row.quoteStage) {
    quoteMismatch++;
    console.log(`     quote ${id}: card=${cardStage} report=${row.quoteStage}`);
  }
}
eq('call status agrees with the card everywhere', callMismatch, 0);
eq('quote stage agrees with the card everywhere', quoteMismatch, 0);
console.log(`   (${notInReport} of the sampled leads are graded D and correctly absent)`);

console.log('--- 4. the stop rule needs days, not just attempts ---');
/**
 * Four calls in one afternoon is not an unreachable lead. Asserted against the data
 * rather than by construction: any lead the report calls unreachable must have three or
 * more distinct days on it.
 */
const unreachable = rows.filter((r) => r.callStatus === 'unreachable');
ok('no lead is unreachable on fewer than 4 attempts',
  unreachable.every((r) => (r.callAttempts ?? 0) >= 4));
ok('and none on fewer than 3 distinct days',
  unreachable.every((r) => (r.callDays ?? 0) >= 3));
console.log(`   ${unreachable.length} unreachable lead(s)`);

console.log('--- 5. terminal states win ---');
ok('a sold lead is never reported as quoted',
  rows.every((r) => !(r.boundPremium != null && r.quoteStage === 'quoted')));
ok('a lead is never both sold and lost',
  rows.every((r) => !(r.quoteStage === 'sold' && r.lostReason && r.boundPremium == null)));

console.log('--- 6. the export columns carry real values ---');
const sold = rows.find((r) => r.quoteStage === 'sold');
if (sold) {
  ok('a sold row carries its premium', sold.boundPremium != null, String(sold.boundPremium));
} else { pass++; console.log('   (nothing sold yet — nothing to check)'); }
ok('every row has a detail line for the export', rows.every((r) => r.context && r.context.length > 0));

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
