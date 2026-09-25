/**
 * Freeze the send list: segment and test arms, per person, balanced within cohort.
 *
 * Usage:
 *   node --import ./scripts/lib/register-ts.mjs scripts/build-send-list.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/build-send-list.mjs --write
 *
 * Idempotent. An account that already carries a segment or an arm keeps it -- reassigning
 * mid-sequence would send one person both arms and make the two comparisons wave one
 * exists to produce unreadable.
 */
import './lib/env.mjs';
import { buildSendList } from '@/services/campaignSegment.service';
import { sql } from '@/lib/neon';

const WRITE = process.argv.includes('--write');
const RANGE = { effFrom: '2026-10-05', effTo: '2026-11-16' };

const [before] = await sql`
  SELECT COUNT(*) FILTER (WHERE "campaignSegment" IS NOT NULL)::int AS segmented,
         COUNT(*) FILTER (WHERE "insuredCtaArm" IS NOT NULL)::int AS insured_armed,
         COUNT(*) FILTER (WHERE "coInsuredCtaArm" IS NOT NULL)::int AS co_armed
    FROM "Lead" WHERE "cohort" BETWEEN ${RANGE.effFrom} AND ${RANGE.effTo}`;
console.log(`before: segmented ${before.segmented} · insured armed ${before.insured_armed} · co-insured armed ${before.co_armed}`);

const r = await buildSendList({ ...RANGE, dryRun: !WRITE });
console.log(`\n${WRITE ? 'WROTE' : 'DRY RUN'} — ${r.cohorts} cohorts · ${r.leads} leads · ${r.peopleAssigned} people`);
console.log(`segments: rated ${r.bySegment.rated} · not rated ${r.bySegment.unrated} · grade B ${r.bySegment.grade_b}`);
if (r.alreadyAssigned) console.log(`left alone (already assigned): ${r.alreadyAssigned}`);

if (!WRITE) { console.log('\nNothing written. Re-run with --write.'); process.exit(0); }

const [after] = await sql`
  SELECT COUNT(*) FILTER (WHERE "campaignSegment" IS NOT NULL)::int AS segmented,
         COUNT(*) FILTER (WHERE "insuredCtaArm" IS NOT NULL)::int AS insured_armed,
         COUNT(*) FILTER (WHERE "coInsuredCtaArm" IS NOT NULL)::int AS co_armed,
         COUNT(*) FILTER (WHERE "sendListBuiltAt" IS NOT NULL)::int AS frozen
    FROM "Lead" WHERE "cohort" BETWEEN ${RANGE.effFrom} AND ${RANGE.effTo}`;
console.log(`\nafter: segmented ${after.segmented} · insured armed ${after.insured_armed} `
  + `· co-insured armed ${after.co_armed} · frozen ${after.frozen}`);

const bal = await sql`
  SELECT "cohort",
         COUNT(*) FILTER (WHERE "insuredSubjectVariant" = 'A')::int AS ins_a,
         COUNT(*) FILTER (WHERE "insuredSubjectVariant" = 'B')::int AS ins_b,
         COUNT(*) FILTER (WHERE "insuredCtaArm" = 1)::int AS ins_1,
         COUNT(*) FILTER (WHERE "insuredCtaArm" = 2)::int AS ins_2,
         COUNT(*) FILTER (WHERE "campaignSegment" = 'rated')::int AS rated,
         COUNT(*) FILTER (WHERE "campaignSegment" = 'unrated')::int AS unrated
    FROM "Lead"
   WHERE "cohort" BETWEEN ${RANGE.effFrom} AND ${RANGE.effTo} AND "campaignSegment" IS NOT NULL
   GROUP BY "cohort" ORDER BY "cohort"`;
console.log('\nas stored — week          rated  unrated   subjA  subjB   arm1   arm2');
for (const b of bal) {
  console.log(`            ${b.cohort}  ${String(b.rated).padStart(5)} ${String(b.unrated).padStart(8)} `
    + `${String(b.ins_a).padStart(7)} ${String(b.ins_b).padStart(6)} ${String(b.ins_1).padStart(6)} ${String(b.ins_2).padStart(6)}`);
}
