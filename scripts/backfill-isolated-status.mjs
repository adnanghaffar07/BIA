/**
 * Give back the status that isolation overwrote.
 *
 * Usage:
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-isolated-status.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-isolated-status.mjs --write
 *
 * -- What this is ------------------------------------------------------------
 * Until 23 Sep 2026, parking a Grade A lead with no insured email wrote 'isolated' into its
 * status and kept the real value in isolatedFromStatus. Isolation is now its own field, so
 * the leads parked under the old rule are the only ones still carrying a status that is not
 * a status: 46 of them, 35 of which were 'rated'.
 *
 * Frank, 23 Sep 2026: "A separate 'isolated' dropdown will be added, so pulling a lead for
 * skip trace never overwrites its 'rated' status." The code no longer does. This is the
 * part the code change cannot do -- the leads it already happened to.
 *
 * -- What it does and does not touch -----------------------------------------
 * Restores "status" from isolatedFromStatus. isolatedAt, isolatedReason and recoveryStage
 * are left exactly as they are: those leads ARE still isolated, and this is not a release
 * from the recovery pipeline. isolatedFromStatus is kept rather than cleared, so the
 * original value survives even if this turns out to be wrong.
 *
 * Refuses any lead whose isolatedFromStatus is missing or is itself 'isolated' -- guessing
 * a status is worse than leaving one visibly wrong.
 *
 * Idempotent: once a lead's status is not 'isolated' it is no longer a candidate.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';

const WRITE = process.argv.includes('--write');

/** Every status the lead card can actually show — 'isolated' has never been among them. */
const VALID = ['new', 'rated', 'referral', 'indicative_sent', 'pos_ran', 'quote_issued', 'bound', 'lost'];

const candidates = await sql`
  SELECT "id", "propertyId", "status", "isolatedFromStatus",
         "isolatedAt" IS NOT NULL AS has_flag,
         "recoveryStage",
         ("travelersPremium" IS NOT NULL OR "plymouthPremium" IS NOT NULL) AS has_premium,
         COALESCE("manualGrade", "grade") AS now_grade
    FROM "Lead"
   WHERE "status" = 'isolated'
   ORDER BY "isolatedFromStatus", "propertyId"`;

const ok = candidates.filter((r) => r.isolatedFromStatus && VALID.includes(r.isolatedFromStatus));
const refused = candidates.filter((r) => !ok.includes(r));

const tally = {};
for (const r of ok) tally[r.isolatedFromStatus] = (tally[r.isolatedFromStatus] ?? 0) + 1;

console.log(`${candidates.length} lead(s) still carry 'isolated' as their status`);
console.log(`${ok.length} can be restored · ${refused.length} refused\n`);
console.log('restoring to:');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(16)} ${v}`);
}
for (const r of refused) {
  console.log(`  REFUSED ${r.propertyId} — isolatedFromStatus = ${r.isolatedFromStatus ?? 'null'}`);
}

/**
 * The isolation flag has to survive. If a lead lost it, restoring the status would quietly
 * un-isolate it and put it back in the send list with no address to send to.
 */
const noFlag = ok.filter((r) => !r.has_flag);
if (noFlag.length) {
  console.log(`\nWARNING: ${noFlag.length} lead(s) have no isolatedAt and would stop reading as isolated:`);
  for (const r of noFlag) console.log(`   ${r.propertyId}`);
}

const ratedBack = ok.filter((r) => r.isolatedFromStatus === 'rated').length;
const ratedReal = ok.filter((r) => r.isolatedFromStatus === 'rated' && r.has_premium).length;
console.log(`\n${ratedBack} go back to 'rated'; ${ratedReal} of those carry a carrier premium`
  + `${ratedBack === ratedReal ? ' — every one agrees' : ' — MISMATCH, check before writing'}`);

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
  process.exit(0);
}

if (noFlag.length) {
  console.log('\nRefusing to write: some leads would stop reading as isolated. Fix those first.');
  process.exit(1);
}

/**
 * One statement, and nothing but the status column.
 *
 * isolatedAt / isolatedReason / recoveryStage are untouched on purpose — these leads are
 * still isolated, and this restores what isolation should never have taken.
 */
const written = await sql`
  UPDATE "Lead"
     SET "status" = "isolatedFromStatus",
         "updatedAt" = NOW()
   WHERE "status" = 'isolated'
     AND "isolatedFromStatus" IS NOT NULL
     AND "isolatedFromStatus" = ANY(${VALID})
     AND "isolatedAt" IS NOT NULL
  RETURNING "id", "propertyId", "status"`;

console.log(`\n${written.length} lead(s) restored`);

/** One Activity row each, so the change is visible on the card that it happened to. */
for (const w of written) {
  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","metadata","createdBy","createdAt")
    VALUES (gen_random_uuid()::text, ${w.id}, 'status_change',
            ${`Status restored to ${w.status}. Isolation is now its own field and no longer overwrites it.`},
            ${JSON.stringify({ changes: [{ field: 'Status', from: 'isolated', to: w.status }] })}::jsonb,
            'system: isolated-status backfill', NOW())`;
}
console.log(`${written.length} activity row(s) written`);

const [left] = await sql`SELECT COUNT(*)::int AS n FROM "Lead" WHERE "status" = 'isolated'`;
const [still] = await sql`SELECT COUNT(*)::int AS n FROM "Lead" WHERE "isolatedAt" IS NOT NULL`;
console.log(`\nstatus = 'isolated' remaining: ${left.n}`);
console.log(`still flagged isolated (unchanged, as intended): ${still.n}`);
