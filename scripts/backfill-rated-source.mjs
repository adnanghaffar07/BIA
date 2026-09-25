/**
 * Record where each premium came from (Frank, 24 Sep 2026 · second email, §3 fix 2).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-rated-source.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-rated-source.mjs --write
 *
 * -- The evidence, and its limits --------------------------------------------
 * A premium is marked 'producer' where the activity history holds a card save that updated
 * a premium field -- the rows reading "Status: new -> rated · Updated: Travelers Premium,
 * Plymouth Premium". That is a person typing into the card, and it is the only positive
 * evidence available for rating done before lastEditedBy existed.
 *
 * Everything else is left NULL rather than guessed at. NULL is a real answer here: it says
 * we cannot tell, and Frank's whole point is that "cannot tell" must never be read as
 * "producer entered it". Marking them 'system' would be the same mistake facing the other
 * way -- asserting a machine wrote something we have no evidence about either.
 *
 * Idempotent: a row that already carries a source keeps it.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';

const WRITE = process.argv.includes('--write');

const [before] = await sql`
  SELECT COUNT(*) FILTER (WHERE "travelersPremium" IS NOT NULL OR "plymouthPremium" IS NOT NULL)::int AS with_premium,
         COUNT(*) FILTER (WHERE "ratedSource" IS NOT NULL)::int AS already_sourced
    FROM "Lead"`;
console.log(`${before.with_premium} accounts carry a carrier premium · ${before.already_sourced} already have a source\n`);

/**
 * The earliest activity row that mentions a premium, per lead. Earliest rather than latest:
 * it is the moment the premium first appeared, which is what the source describes.
 */
const evidence = await sql`
  SELECT l."id", l."propertyId",
         (SELECT a."createdAt" FROM "Activity" a
           WHERE a."leadId" = l."id" AND a."content" ILIKE '%Premium%'
           ORDER BY a."createdAt" LIMIT 1) AS first_at,
         (SELECT a."createdBy" FROM "Activity" a
           WHERE a."leadId" = l."id" AND a."content" ILIKE '%Premium%'
           ORDER BY a."createdAt" LIMIT 1) AS first_by,
         l."lastEditedBy"
    FROM "Lead" l
   WHERE (l."travelersPremium" IS NOT NULL OR l."plymouthPremium" IS NOT NULL)
     AND l."ratedSource" IS NULL`;

const provable = evidence.filter((r) => r.first_at != null);
const unknown = evidence.filter((r) => r.first_at == null);

console.log(`  provable as producer-entered : ${provable.length}`);
console.log(`  no evidence either way       : ${unknown.length}`);
const named = provable.filter((r) => r.first_by || r.lastEditedBy).length;
console.log(`  ...of the provable, carrying a name: ${named}\n`);

if (unknown.length) {
  const byCohort = await sql`
    SELECT "cohort", COUNT(*)::int AS n FROM "Lead"
     WHERE ("travelersPremium" IS NOT NULL OR "plymouthPremium" IS NOT NULL)
       AND "ratedSource" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Activity" a WHERE a."leadId" = "Lead"."id" AND a."content" ILIKE '%Premium%')
       AND COALESCE("manualGrade","grade") = 'A'
     GROUP BY "cohort" ORDER BY "cohort"`;
  console.log('  the unknowns that are Grade A, by renewal week:');
  for (const c of byCohort) {
    const inSend = c.cohort >= '2026-10-05' && c.cohort <= '2026-11-16' ? '  <- on the send list' : '';
    console.log(`     ${c.cohort}  ${String(c.n).padStart(3)}${inSend}`);
  }
}

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write.');
  process.exit(0);
}

/**
 * One statement, and the timestamp never leaves Postgres. Activity.createdAt and
 * Lead.ratedAt are both `timestamp without time zone`: a value that round-trips through the
 * driver is read as local and written back as UTC, which shifted eight timestamps by seven
 * hours on a real lead earlier in this project.
 */
const written = await sql`
  UPDATE "Lead" l
     SET "ratedSource" = 'producer',
         "ratedAt" = ev.first_at,
         "ratedBy" = COALESCE(ev.first_by, l."lastEditedBy"),
         "updatedAt" = NOW()
    FROM (
      SELECT a."leadId",
             MIN(a."createdAt") AS first_at,
             (ARRAY_AGG(a."createdBy" ORDER BY a."createdAt"))[1] AS first_by
        FROM "Activity" a
       WHERE a."content" ILIKE '%Premium%'
       GROUP BY a."leadId"
    ) ev
   WHERE ev."leadId" = l."id"
     AND (l."travelersPremium" IS NOT NULL OR l."plymouthPremium" IS NOT NULL)
     AND l."ratedSource" IS NULL
  RETURNING l."propertyId"`;

console.log(`\n${written.length} account(s) marked producer-entered`);

const [after] = await sql`
  SELECT COUNT(*) FILTER (WHERE "travelersPremium" IS NOT NULL OR "plymouthPremium" IS NOT NULL)::int AS with_premium,
         COUNT(*) FILTER (WHERE "ratedSource" = 'producer')::int AS producer,
         COUNT(*) FILTER (WHERE ("travelersPremium" IS NOT NULL OR "plymouthPremium" IS NOT NULL)
                            AND "ratedSource" IS NULL)::int AS still_unknown
    FROM "Lead"`;
console.log(`\nafter: ${after.with_premium} with a premium · ${after.producer} producer-entered `
  + `· ${after.still_unknown} still unknown`);
console.log('\nThe unknowns are left NULL on purpose. "We cannot tell" is a real answer, and');
console.log('the one thing it must never be read as is "a producer entered it".');
