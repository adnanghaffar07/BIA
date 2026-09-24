/**
 * The Grade A departures that have no GradeChange row.
 *
 * Usage:
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-gradechange-overrides.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-gradechange-overrides.mjs --write
 *
 * -- What this is ------------------------------------------------------------
 * GradeChange started being written on 17 Sep 2026 at 21:07. Five overrides made in the
 * hour that followed set gradeOverrideBy/Reason/At on the lead and wrote an Activity note,
 * but no GradeChange row -- a day-one adoption gap, 5 of 397 overrides, none since.
 *
 * The Cohort Ledger counts those five as "unexplained", a column that is supposed to mean
 * "a lead left Grade A and nobody knows why". Five permanent false positives in it teach
 * people to ignore the number, which is the only thing that column is for.
 *
 * -- Nothing is invented -----------------------------------------------------
 * Every field is copied from what the lead already carries. Who, when and why are all on
 * the lead; the Activity note is matched by lead and timestamp so each row points at its
 * own evidence. A lead missing any of those is refused rather than guessed at -- replacing
 * "unexplained" with an explanation nobody gave is worse than the gap it closes.
 *
 * -- Two traps, both already sprung once in this project ---------------------
 * 1. The whole write is one INSERT ... SELECT. "Lead"."gradeOverrideAt" and
 *    "GradeChange"."changedAt" are both `timestamp without time zone`: the driver reads one
 *    as a local Date and serialises it back as UTC, so a value that merely round-trips
 *    through JS lands shifted by the local offset. That corrupted 8 timestamps by +7h on a
 *    real lead earlier in this project. Keeping the value inside Postgres makes the class
 *    of bug impossible rather than merely avoided.
 *
 * 2. `source` is 'producer', not 'backfill'. The schema is explicit -- 'producer' = a
 *    person overrode it, 'system' = the grading rules did -- and the QC by-user/by-system
 *    split reads it. A third value would put these five in neither bucket, trading a
 *    visible gap in one report for an invisible one in another. That these rows were
 *    written late is recorded by `activityId`, which the schema says exists so a
 *    backfilled entry can be traced back.
 *
 * Idempotent: the partial unique index on "activityId" means re-running writes nothing.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';

const WRITE = process.argv.includes('--write');

/** Leads that left Grade A, have no GradeChange row, and say who/when/why on themselves. */
const eligible = await sql`
  SELECT l."propertyId", l."manualGrade", l."grade",
         l."gradeOverrideBy", l."gradeOverrideReason",
         to_char(l."gradeOverrideAt", 'YYYY-MM-DD HH24:MI:SS') AS changed_at,
         (SELECT a."id" FROM "Activity" a
           WHERE a."leadId" = l."id"
             AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."gradeOverrideAt"))) < 120
           ORDER BY ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."gradeOverrideAt")))
           LIMIT 1) AS activity_id
    FROM "Lead" l
   WHERE l."gradeAtPull" = 'A'
     AND COALESCE(l."manualGrade", l."grade") <> 'A'
     AND l."gradeOverrideBy" IS NOT NULL
     AND l."gradeOverrideAt" IS NOT NULL
     AND l."gradeOverrideReason" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "GradeChange" g WHERE g."leadId" = l."id")
   ORDER BY l."gradeOverrideAt"`;

/** The same population WITHOUT the who/when/why test — the difference is what gets refused. */
const all = await sql`
  SELECT l."propertyId", l."gradeOverrideBy", l."gradeOverrideReason", l."gradeOverrideAt"
    FROM "Lead" l
   WHERE l."gradeAtPull" = 'A'
     AND COALESCE(l."manualGrade", l."grade") <> 'A'
     AND NOT EXISTS (SELECT 1 FROM "GradeChange" g WHERE g."leadId" = l."id")`;

const refused = all.filter((r) => !r.gradeOverrideBy || !r.gradeOverrideAt || !r.gradeOverrideReason);

console.log(`${all.length} lead(s) left Grade A with no GradeChange row`);
console.log(`${eligible.length} can be reconstructed from their own columns · ${refused.length} refused\n`);

for (const r of eligible) {
  console.log(`  ${r.propertyId}  A -> ${r.manualGrade ?? r.grade}   source=producer`);
  console.log(`     changedBy  ${r.gradeOverrideBy}`);
  console.log(`     changedAt  ${r.changed_at}   (read as text, never parsed in JS)`);
  console.log(`     reason     "${r.gradeOverrideReason}"`);
  console.log(`     activityId ${r.activity_id ?? '(no Activity within 2 min)'}`);
}
for (const r of refused) {
  console.log(`  REFUSED ${r.propertyId} — incomplete: by=${r.gradeOverrideBy ?? 'null'}, `
    + `at=${r.gradeOverrideAt ?? 'null'}, reason=${r.gradeOverrideReason ? 'set' : 'null'}`);
}

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
  process.exit(0);
}

/**
 * One statement. The timestamp is copied column-to-column and never enters JS; the
 * ON CONFLICT makes a re-run a no-op.
 */
const written = await sql`
  INSERT INTO "GradeChange"
    ("id","leadId","fromGrade","toGrade","source","reason","changedBy","changedAt","activityId")
  SELECT gen_random_uuid()::text,
         l."id",
         'A',
         COALESCE(l."manualGrade", l."grade"),
         'producer',
         l."gradeOverrideReason",
         l."gradeOverrideBy",
         l."gradeOverrideAt",
         (SELECT a."id" FROM "Activity" a
           WHERE a."leadId" = l."id"
             AND ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."gradeOverrideAt"))) < 120
           ORDER BY ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."gradeOverrideAt")))
           LIMIT 1)
    FROM "Lead" l
   WHERE l."gradeAtPull" = 'A'
     AND COALESCE(l."manualGrade", l."grade") <> 'A'
     AND l."gradeOverrideBy" IS NOT NULL
     AND l."gradeOverrideAt" IS NOT NULL
     AND l."gradeOverrideReason" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "GradeChange" g WHERE g."leadId" = l."id")
  ON CONFLICT ("activityId") WHERE "activityId" IS NOT NULL DO NOTHING
  RETURNING "leadId", to_char("changedAt", 'YYYY-MM-DD HH24:MI:SS') AS changed_at`;

console.log(`\n${written.length} row(s) written`);
for (const w of written) console.log(`  ${w.leadId}  changedAt ${w.changed_at}`);

/**
 * Prove the wall clock survived — for THE ROWS THIS RUN WROTE, and nothing else.
 *
 * The first version of this check compared every producer row against its lead and
 * reported 359 mismatches. All of them were pre-existing and fine: 286 differ by under a
 * second, because the lead update and its audit row are written milliseconds apart, and
 * the rest belong to the 10 leads with more than one producer override — gradeOverrideAt
 * holds only the LATEST, so an earlier row is supposed to differ.
 *
 * A check that shouts on correct data is worse than no check, because the one time it is
 * right nobody will believe it. Scoped to this run's ids, and compared at full precision
 * rather than through to_char, which hides a sub-second difference and invents one.
 */
const ids = written.map((w) => w.leadId);
if (ids.length) {
  const drift = await sql`
    SELECT l."propertyId",
           to_char(l."gradeOverrideAt", 'YYYY-MM-DD HH24:MI:SS.US') AS lead_at,
           to_char(g."changedAt", 'YYYY-MM-DD HH24:MI:SS.US') AS change_at
      FROM "GradeChange" g JOIN "Lead" l ON l."id" = g."leadId"
     WHERE g."leadId" = ANY(${ids})
       AND g."source" = 'producer'
       AND g."changedAt" <> l."gradeOverrideAt"`;
  if (drift.length) {
    console.log(`\nWARNING: ${drift.length} row(s) whose timestamp does not match the lead:`);
    for (const d of drift) console.log(`  ${d.propertyId}  lead ${d.lead_at} vs change ${d.change_at}`);
  } else {
    console.log(`\ntimestamps verified — all ${ids.length} written row(s) match their lead exactly`);
  }
}
