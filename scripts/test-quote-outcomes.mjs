/**
 * Band accuracy and lost quotes (directive Sec. 10.9, Sec. 10.6).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-quote-outcomes.mjs
 *
 * Writes to the live database on one marked lead and restores it afterwards. The cases
 * that matter are the arithmetic ones — a band measured against the wrong band, a gap
 * averaged over the rows that happened to carry a figure, a re-engagement date scheduled
 * in the past. Each of those produces a plausible number that is wrong.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import {
  recordBandRating, recordQuote, recordLoss, bandAccuracy, lossAnalysis,
} from '@/services/quoteOutcomes.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const [seed] = await sql`
  SELECT "id","effectiveDate"::text AS eff,"indicativeBandLow","indicativeBandHigh",
         "publishedBandLow","publishedBandHigh","quotedPremium","quotedCarrier","quotedAt",
         "lostAt","lostReason","lostNotes","competitorCarrier","competitorPremium",
         "bandCarrier","bandRatedAt","bandRatedBy","bandHitAtQuote","bandQuoteMeasuredAt",
         "revisitFlag","revisitDate","revisitNote"
    FROM "Lead" WHERE "effectiveDate" IS NOT NULL ORDER BY "id" LIMIT 1`;
if (!seed) { console.error('no lead'); process.exit(1); }
console.log(`lead ${seed.id} · effective ${seed.eff}\n`);

const restore = async () => {
  await sql`
    UPDATE "Lead" SET
      "indicativeBandLow" = ${seed.indicativeBandLow}, "indicativeBandHigh" = ${seed.indicativeBandHigh},
      "publishedBandLow" = ${seed.publishedBandLow}, "publishedBandHigh" = ${seed.publishedBandHigh},
      "quotedPremium" = ${seed.quotedPremium}, "quotedCarrier" = ${seed.quotedCarrier},
      "quotedAt" = ${seed.quotedAt}, "lostAt" = ${seed.lostAt}, "lostReason" = ${seed.lostReason},
      "lostNotes" = ${seed.lostNotes}, "competitorCarrier" = ${seed.competitorCarrier},
      "competitorPremium" = ${seed.competitorPremium}, "bandCarrier" = ${seed.bandCarrier},
      "bandRatedAt" = ${seed.bandRatedAt}, "bandRatedBy" = ${seed.bandRatedBy},
      "bandHitAtQuote" = ${seed.bandHitAtQuote}, "bandQuoteMeasuredAt" = ${seed.bandQuoteMeasuredAt},
      "revisitFlag" = ${seed.revisitFlag ?? false}, "revisitDate" = ${seed.revisitDate},
      "revisitNote" = ${seed.revisitNote}
    WHERE "id" = ${seed.id}`;
  await sql`DELETE FROM "Activity" WHERE "leadId" = ${seed.id} AND "createdBy" = 'test'`;
};
const read = async () => (await sql`
  SELECT "indicativeBandLow","indicativeBandHigh","bandCarrier","bandRatedBy",
         "quotedPremium","quotedCarrier","bandHitAtQuote","lostAt","lostReason",
         "competitorCarrier","competitorPremium","revisitFlag","revisitDate"::text AS revisit
    FROM "Lead" WHERE "id" = ${seed.id}`)[0];

try {
  await restore();

  console.log('--- 1. rating provenance ---');
  await recordBandRating({ leadId: seed.id, low: 2000, high: 2400, carrier: 'Travelers', by: 'test' });
  let l = await read();
  eq('band stored', [Number(l.indicativeBandLow), Number(l.indicativeBandHigh)], [2000, 2400]);
  eq('carrier recorded', l.bandCarrier, 'Travelers');
  eq('who rated it recorded', l.bandRatedBy, 'test');

  let threw = false;
  try { await recordBandRating({ leadId: seed.id, low: 3000, high: 2000, carrier: 'X', by: 'test' }); }
  catch { threw = true; }
  ok('an inverted band is refused', threw);

  console.log('--- 2. a quote INSIDE the band ---');
  let r = await recordQuote({ leadId: seed.id, premium: 2200, carrier: 'Travelers', by: 'test' });
  eq('inside', r.bandHitAtQuote, true);
  eq('variance vs midpoint is zero at the midpoint', r.varianceVsMidpointPct, 0);

  console.log('--- 3. a quote OUTSIDE, and the midpoint measure ---');
  await sql`UPDATE "Lead" SET "quotedAt" = NULL, "bandHitAtQuote" = NULL WHERE "id" = ${seed.id}`;
  r = await recordQuote({ leadId: seed.id, premium: 3300, carrier: 'Travelers', by: 'test' });
  eq('outside', r.bandHitAtQuote, false);
  // midpoint 2200 → (3300-2200)/2200 = +50%
  eq('variance vs midpoint is +50%', r.varianceVsMidpointPct, 50);

  console.log('--- 4. measured against the PUBLISHED band, not the current one ---');
  // The homeowner read 1000-1200 in email 2; the lead has since been re-rated to 2000-2400.
  await sql`
    UPDATE "Lead" SET "publishedBandLow" = 1000, "publishedBandHigh" = 1200,
           "quotedAt" = NULL, "bandHitAtQuote" = NULL WHERE "id" = ${seed.id}`;
  r = await recordQuote({ leadId: seed.id, premium: 2200, carrier: 'Travelers', by: 'test' });
  ok('a quote inside the CURRENT band still misses the PUBLISHED one', r.bandHitAtQuote === false,
    `hit=${r.bandHitAtQuote}`);

  console.log('--- 5. a loss, with the competitor captured ---');
  await sql`UPDATE "Lead" SET "quotedPremium" = 2200 WHERE "id" = ${seed.id}`;
  const loss = await recordLoss({
    leadId: seed.id, reason: 'premium',
    competingCarrier: 'Plymouth Rock', competingPremium: 1900,
    notes: 'beat us on price', by: 'test',
  });
  eq('gap in dollars', loss.premiumGap, 300);
  // 300/1900 = 15.79%
  eq('gap as a percent of THEIR premium', loss.premiumGapPct, 15.79);
  l = await read();
  eq('competitor stored', [l.competitorCarrier, Number(l.competitorPremium)], ['Plymouth Rock', 1900]);
  ok('lost stamped', l.lostAt != null);

  console.log('--- 6. re-engagement is scheduled for NEXT year, not the past ---');
  ok('revisit flagged', l.revisitFlag === true);
  // Computed the same way the service must: local parts, never an instant.
  const [y, mo, d] = seed.eff.slice(0, 10).split('-').map(Number);
  const ex = new Date(y + 1, mo - 1, d - 60);
  const pad = (n) => String(n).padStart(2, '0');
  const want = ex.getFullYear() + '-' + pad(ex.getMonth() + 1) + '-' + pad(ex.getDate());
  eq('60 days before the NEXT renewal', String(l.revisit).slice(0, 10), want);
  ok('and that date is in the future', new Date(l.revisit) > new Date(),
    `revisit=${l.revisit}`);

  console.log('--- 7. a reason that does not re-engage ---');
  await restore();
  await sql`UPDATE "Lead" SET "quotedPremium" = 2200 WHERE "id" = ${seed.id}`;
  const notEligible = await recordLoss({ leadId: seed.id, reason: 'not_eligible', by: 'test' });
  eq('no re-engagement for an appetite loss', notEligible.reEngageAt, null);
  eq('and no gap without a competitor figure', notEligible.premiumGap, null);

  console.log('--- 8. the reports ---');
  const acc = await bandAccuracy('carrier');
  ok('accuracy report builds', Array.isArray(acc));
  const la = await lossAnalysis();
  ok('loss report builds', Array.isArray(la.rows));
  ok('losses with no competitor are counted, not hidden', typeof la.missingCompetitor === 'number');
  const noFigure = la.rows.find((x) => x.carrier === '(not recorded)');
  if (noFigure) ok('and excluded from the average', noFigure.avgGap === null || noFigure.withPremium === 0);
  else pass++;
} finally {
  await restore();
  const l = await read();
  console.log(`\ncleanup: lostReason=${l.lostReason} · bandCarrier=${l.bandCarrier} · quoted=${l.quotedPremium} (all should match the original)`);
}

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
