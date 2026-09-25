/**
 * Seed the Recapture Log with the recaptures that already happened (Frank, fix 22).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-recapture-log.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-recapture-log.mjs --write
 *
 * -- Why backfill at all ------------------------------------------------------
 * The log starts empty, and an empty Recapture Log tab says "nothing has come back" when
 * 34 accounts have. Frank would read the tab, see zero, and reasonably conclude the
 * pipeline produced nothing -- which is the opposite of what happened.
 *
 * -- What is NOT reconstructed -----------------------------------------------
 * priorStatus is left NULL on every backfilled row. The status an account held before it
 * came back is not on the record any more: isolatedFromStatus is cleared by the recovery
 * itself, so the only thing available is what the account reads as NOW, and writing that
 * into a column labelled "before" would be an invention. Rows written from here on carry
 * the real value, because the pipeline captures it at the moment it is still true.
 *
 * Idempotent: the unique index on (leadId, process) means a second run adds nothing.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';

const WRITE = process.argv.includes('--write');

const [before] = await sql`
  SELECT (SELECT COUNT(*) FROM "Lead" WHERE "recoveryStage" = 'recovered')::int AS recovered,
         (SELECT COUNT(*) FROM "RecaptureLog")::int AS logged`;
console.log(`${before.recovered} accounts have been recaptured · ${before.logged} already in the log\n`);

/**
 * Held = the cohort's list was built AND this lead is not on it. Both halves, so a lead
 * that was on the list and later re-traced is not reported as a late arrival.
 */
const preview = await sql`
  SELECT l."cohort",
         COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE l."sendListBuiltAt" IS NULL AND EXISTS (
           SELECT 1 FROM "Lead" f WHERE f."cohort" = l."cohort" AND f."sendListBuiltAt" IS NOT NULL
         ))::int AS held,
         COUNT(*) FILTER (WHERE l."recoveredBy" = 'tracerfy')::int AS tracerfy,
         COUNT(*) FILTER (WHERE l."recoveredBy" = 'batchdata')::int AS batchdata
    FROM "Lead" l
   WHERE l."recoveryStage" = 'recovered'
     AND NOT EXISTS (SELECT 1 FROM "RecaptureLog" r WHERE r."leadId" = l."id")
   GROUP BY l."cohort" ORDER BY l."cohort"`;

console.log('  cohort        back   held   Tracerfy   BatchData');
for (const r of preview) {
  console.log(`  ${String(r.cohort ?? '(none)').padEnd(12)} ${String(r.n).padStart(4)}`
    + ` ${String(r.held).padStart(6)} ${String(r.tracerfy).padStart(10)} ${String(r.batchdata).padStart(11)}`);
}

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write.');
  process.exit(0);
}

/**
 * One statement, and recoveredAt never leaves Postgres.
 *
 * Both columns are `timestamp without time zone`. A value read into JavaScript is parsed as
 * local and written back as UTC, which silently moved eight timestamps by seven hours on a
 * real lead earlier in this project. Copying it column-to-column cannot do that.
 */
const written = await sql`
  INSERT INTO "RecaptureLog"
    ("id","leadId","propertyId","cohort","recapturedAt","process",
     "priorStatus","priorGrade","newGrade","heldFromCohort","note","createdAt")
  SELECT gen_random_uuid()::text,
         l."id",
         l."propertyId",
         l."cohort",
         COALESCE(l."recoveredAt", l."updatedAt"),
         COALESCE(l."recoveredBy", 'manual'),
         NULL,
         NULL,
         COALESCE(l."manualGrade", l."grade"),
         l."sendListBuiltAt" IS NULL AND EXISTS (
           SELECT 1 FROM "Lead" f WHERE f."cohort" = l."cohort" AND f."sendListBuiltAt" IS NOT NULL
         ),
         'Backfilled from the recovery pipeline. The status held before recapture was not '
           || 'captured at the time and is deliberately left blank rather than guessed.',
         NOW()
    FROM "Lead" l
   WHERE l."recoveryStage" = 'recovered'
  ON CONFLICT ("leadId","process") DO NOTHING
  RETURNING "id"`;

console.log(`\n${written.length} event(s) written`);

const [after] = await sql`
  SELECT COUNT(*)::int AS logged,
         COUNT(*) FILTER (WHERE "heldFromCohort")::int AS held,
         COUNT(*) FILTER (WHERE "recapturedAt" IS NULL)::int AS undated
    FROM "RecaptureLog"`;
console.log(`after: ${after.logged} events · ${after.held} held from a frozen cohort · ${after.undated} without a date`);
