import crypto from 'crypto';
import { pool } from '@/lib/neon';

/**
 * The grade-change log, and the grade each lead started at (register A8).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * "Lead"."grade" is overwritten in place, so a downgraded lead keeps no memory of what it
 * was when its cohort was pulled. Every "the 10/5 cohort had 74 Grade A" is therefore a
 * CURRENT count being read as a STARTING count, and the gap grows every time anyone
 * re-grades.
 *
 * Grade changes themselves were scattered across the activity feed under two unrelated
 * types — 250 filed as 'note', 110 as 'grade_override' — with the actual change buried in
 * a JSON array. A report reading only 'grade_override' missed 70% of them, which is
 * precisely the bug found in the QC Grade Changes report in September.
 *
 * This module does two things, both from the same source of truth:
 *   1. rebuilds the GradeChange log from the activity feed
 *   2. derives each lead's starting grade from the EARLIEST change on record
 *
 * Both are recoverable exactly once, and only while the activity log still holds every
 * change.
 */

export type BackfillResult = {
  activitiesScanned: number;
  changesWritten: number;
  changesSkipped: number;
  gradeAtPullSet: number;
  /** Leads whose starting grade differs from their grade today. */
  downgraded: number;
  upgraded: number;
};

/** One entry in an activity's `metadata.changes` array. */
type Change = { field?: string; from?: string; to?: string };

/**
 * A producer override always carries a structured reason; the rules never do. That is the
 * distinction the by-user / by-system split in QC depends on — there is no separate flag
 * to read, and inventing one now would not classify the 360 rows already on record.
 */
function sourceOf(activityType: string, createdBy: string | null): 'producer' | 'system' {
  if (activityType === 'grade_system') return 'system';
  // 'grade_override' is written by the lead-edit route, which only runs for a signed-in
  // person. A 'note' carrying a grade change is the same thing filed under a looser type.
  if (createdBy && /system|rules|enrich/i.test(createdBy)) return 'system';
  return 'producer';
}

/**
 * Rebuild the log from the activity feed.
 *
 * Idempotent: each row is keyed to the activity it came from by a unique index, so a
 * second run inserts nothing. Safe to re-run after new activity accumulates.
 */
export async function backfillGradeHistory(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun ?? false;

  // Both shapes: a change recorded inside metadata.changes, and the dedicated system type.
  const { rows: activities } = await pool.query(
    `SELECT a."id", a."leadId", a."type", a."content", a."metadata", a."createdBy", a."createdAt"
       FROM "Activity" a
      WHERE a."metadata" -> 'changes' @> '[{"field":"Grade"}]'::jsonb
         OR a."type" = 'grade_system'
      ORDER BY a."createdAt" ASC`,
  );

  let changesWritten = 0;
  let changesSkipped = 0;

  for (const a of activities) {
    const changes: Change[] = Array.isArray(a.metadata?.changes) ? a.metadata.changes : [];
    const grade = changes.find((c) => c.field === 'Grade');

    // A 'grade_system' row may carry the change differently; fall back to its metadata.
    const fromGrade = grade?.from ?? a.metadata?.from ?? null;
    const toGrade = grade?.to ?? a.metadata?.to ?? null;
    if (!fromGrade && !toGrade) { changesSkipped++; continue; }
    if (fromGrade === toGrade) { changesSkipped++; continue; }

    if (dryRun) { changesWritten++; continue; }

    const { rowCount } = await pool.query(
      `INSERT INTO "GradeChange" ("id","leadId","fromGrade","toGrade","source","reason","changedBy","changedAt","activityId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ("activityId") WHERE "activityId" IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        a.leadId,
        fromGrade === '(empty)' ? null : fromGrade,
        toGrade === '(empty)' ? null : toGrade,
        sourceOf(a.type, a.createdBy),
        // The note IS the reason for the 250 filed that way; for an override the content
        // already carries the structured reason in parentheses.
        String(a.content ?? '').slice(0, 500) || null,
        a.createdBy ?? null,
        a.createdAt,
        a.id,
      ],
    );
    if (rowCount) changesWritten++; else changesSkipped++;
  }

  /**
   * The starting grade.
   *
   * For a lead with history it is the `from` of its EARLIEST recorded change — that is
   * what it was before anyone touched it. For a lead with no history the grade it carries
   * today has never changed, so it is its own starting grade.
   *
   * COALESCE on the write: set once. Re-running must never move a baseline, or every
   * cohort total computed against it silently changes.
   */
  let gradeAtPullSet = 0;
  if (!dryRun) {
    const { rowCount: fromHistory } = await pool.query(
      `UPDATE "Lead" l
          SET "gradeAtPull"   = first_change."fromGrade",
              "gradeAtPullAt" = COALESCE(l."createdAt", first_change."changedAt"),
              "updatedAt"     = NOW()
         FROM (
           SELECT DISTINCT ON ("leadId") "leadId", "fromGrade", "changedAt"
             FROM "GradeChange"
            WHERE "fromGrade" IS NOT NULL
            ORDER BY "leadId", "changedAt" ASC
         ) AS first_change
        WHERE l."id" = first_change."leadId"
          AND l."gradeAtPull" IS NULL`,
    );
    const { rowCount: fromCurrent } = await pool.query(
      `UPDATE "Lead"
          SET "gradeAtPull"   = "grade",
              "gradeAtPullAt" = COALESCE("createdAt", NOW()),
              "updatedAt"     = NOW()
        WHERE "gradeAtPull" IS NULL
          AND "grade" IS NOT NULL`,
    );
    gradeAtPullSet = (fromHistory ?? 0) + (fromCurrent ?? 0);
  }

  const { rows: drift } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE "gradeAtPull" IS NOT NULL AND "grade" IS NOT NULL AND "gradeAtPull" < "grade")::int AS downgraded,
       COUNT(*) FILTER (WHERE "gradeAtPull" IS NOT NULL AND "grade" IS NOT NULL AND "gradeAtPull" > "grade")::int AS upgraded
     FROM "Lead"`,
  );

  return {
    activitiesScanned: activities.length,
    changesWritten,
    changesSkipped,
    gradeAtPullSet,
    // Grades sort A < B < C < D, so a LOWER starting grade means it got worse.
    downgraded: drift[0]?.downgraded ?? 0,
    upgraded: drift[0]?.upgraded ?? 0,
  };
}

/**
 * Record a grade change as it happens.
 *
 * Called from the write paths so the log stays complete without another backfill. The
 * activity feed still gets its own entry for the human timeline; this is what reports read.
 */
export async function recordGradeChange(input: {
  leadId: string;
  fromGrade: string | null;
  toGrade: string | null;
  source: 'producer' | 'system';
  reason?: string | null;
  changedBy?: string | null;
  at?: Date;
}): Promise<void> {
  if (input.fromGrade === input.toGrade) return;
  await pool.query(
    `INSERT INTO "GradeChange" ("id","leadId","fromGrade","toGrade","source","reason","changedBy","changedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      crypto.randomUUID(), input.leadId, input.fromGrade, input.toGrade,
      input.source, input.reason ?? null, input.changedBy ?? null, input.at ?? new Date(),
    ],
  );
}
