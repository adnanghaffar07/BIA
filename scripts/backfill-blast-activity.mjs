/**
 * Marks past blast traces in the activity log (register A44).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/backfill-blast-activity.mjs
 *         ... --apply     write the markers
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * Frank, 17 Sep 2026, asked six times whether a mass skip trace would have been recorded
 * on the card. It was — but the row read exactly like a hand-run trace, so the honest
 * answer from the screen was "cannot tell", and twenty minutes went into reconstructing
 * from memory what one line could have stated.
 *
 * traceAndApply now stamps new blasts as they happen. This recovers the three runs that
 * already happened, which is the history the question was actually about.
 *
 * Nothing is invented. "Lead"."blastRunId" and "blastSkipTracedAt" already record which
 * run touched a lead and when; this only copies that onto the activity it produced, so a
 * card can be read without opening the database. Every marker carries `backfilled: true`
 * so nobody later mistakes it for something recorded at the time.
 *
 * Idempotent: an activity that already carries a marker is skipped, so re-running is safe.
 */
import './lib/env.mjs';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const APPLY = process.argv.includes('--apply');

/**
 * The activity each blast produced.
 *
 * A lead can carry several skip traces, so the one NEAREST the recorded blast timestamp
 * is the one that run produced. Matching every skip_trace on the lead would label a
 * producer's later hand-run trace as part of the blast — the exact confusion this is
 * meant to end.
 */
const candidates = await sql`
  SELECT DISTINCT ON (l."id")
         a."id"            AS activity_id,
         a."content"       AS content,
         a."metadata"->'blast'->>'runId' AS existing_marker,
         l."id"            AS lead_id,
         l."blastRunId"    AS run_id,
         l."blastSkipTracedBy" AS ran_by,
         ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."blastSkipTracedAt"))) AS drift_seconds
    FROM "Lead" l
    JOIN "Activity" a
      ON a."leadId" = l."id" AND a."type" = 'skip_trace'
   WHERE l."blastRunId" IS NOT NULL
     AND l."blastSkipTracedAt" IS NOT NULL
   ORDER BY l."id", ABS(EXTRACT(EPOCH FROM (a."createdAt" - l."blastSkipTracedAt")))`;

const todo = candidates.filter((c) => !c.existing_marker);
const byRun = new Map();
for (const c of todo) byRun.set(c.run_id, (byRun.get(c.run_id) ?? 0) + 1);
const worstDrift = candidates.reduce((m, c) => Math.max(m, Number(c.drift_seconds)), 0);

console.log(`\nblast-traced leads:        ${candidates.length}`);
console.log(`already marked:            ${candidates.length - todo.length}`);
console.log(`to mark:                   ${todo.length}`);
console.log(`worst activity/blast drift: ${Math.round(worstDrift)}s`);
console.log('\nby run:');
for (const [run, n] of byRun) console.log(`  ${run}  ${String(n).padStart(4)} leads`);

/**
 * A wide drift means the nearest skip trace is probably not the one the blast produced.
 * Ten minutes is generous for a run that writes each lead as it goes; past that, stop
 * rather than attach a run id to the wrong activity.
 */
if (worstDrift > 600) {
  console.error(`\nRefusing to write: an activity is ${Math.round(worstDrift)}s from its blast timestamp.`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.\n');
  for (const c of todo.slice(0, 3)) {
    console.log(`  lead ${c.lead_id}: "${c.content}"`);
    console.log(`    → marked as run ${c.run_id}, ${Math.round(c.drift_seconds)}s from the blast\n`);
  }
  process.exit(0);
}

let written = 0;
for (const c of todo) {
  // The content prefix and the metadata marker go on together: reports read the text,
  // the card reads the metadata, and only one of them being marked is how the two
  // disagree later.
  const marked = /^Cohort blast/.test(c.content)
    ? c.content
    : `Cohort blast — ${String(c.content).replace(/^Skip trace: /, '')}`;
  // RETURNING, not rowCount: neon's tagged template resolves to an ARRAY of rows, so
  // destructuring `rowCount` off it yields undefined and the counter silently reports
  // zero for work it really did. A backfill that says it changed nothing while changing
  // 260 rows invites a re-run, and is indistinguishable from one that genuinely failed.
  const updated = await sql`
    UPDATE "Activity"
       SET "metadata" = COALESCE("metadata", '{}'::jsonb)
                        || jsonb_build_object('blast', jsonb_build_object(
                             'runId', ${c.run_id}::text,
                             'ranBy', ${c.ran_by}::text,
                             'backfilled', true)),
           "content" = ${marked}
     WHERE "id" = ${c.activity_id}
       AND "metadata"->'blast'->>'runId' IS NULL
   RETURNING "id"`;
  written += updated.length;
}

console.log(`\nmarked ${written} activities across ${byRun.size} runs\n`);
