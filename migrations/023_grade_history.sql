-- Register A8: "grade-at-pull snapshot, per-cohort starting count, one grade-change log
-- for manual and system changes with reason code".
--
-- ── Why a snapshot ───────────────────────────────────────────────────────────
-- "Lead"."grade" is overwritten in place. Once a lead is downgraded there is nothing left
-- saying what it was when the cohort was pulled, so "the 10/5 cohort had 74 Grade A" is
-- unanswerable the moment anyone re-grades. Every cohort total Frank has been given is a
-- CURRENT count being read as a STARTING count.
--
-- The history is recoverable exactly once, from the activity log, and only while that log
-- still holds every change. It does today: 360 grade changes are on record. This migration
-- captures the starting grade before that stops being true.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "gradeAtPull"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "gradeAtPullAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Lead_gradeAtPull_idx" ON "Lead" ("cohort", "gradeAtPull");

-- ── One log, both kinds of change ────────────────────────────────────────────
-- Grade changes are currently scattered across the activity feed under two different
-- types — 250 filed as 'note' and 110 as 'grade_override' — with the actual change buried
-- in a JSON array. A report that looked only at 'grade_override' would miss 70% of them,
-- which is exactly the bug found in the QC Grade Changes report in September.
--
-- This is the single place a grade change is recorded, whoever or whatever made it. The
-- activity feed keeps its entries for the human timeline; this table is what reports read.
CREATE TABLE IF NOT EXISTS "GradeChange" (
  "id"         TEXT PRIMARY KEY,
  "leadId"     TEXT NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "fromGrade"  TEXT,
  "toGrade"    TEXT,
  -- 'producer' = a person overrode it. 'system' = the grading rules changed it.
  -- The distinction is the whole point of the by-user / by-system split in QC.
  "source"     TEXT NOT NULL,
  -- The structured reason where one was captured, else the free-text note.
  "reason"     TEXT,
  "changedBy"  TEXT,
  "changedAt"  TIMESTAMP NOT NULL,
  -- Which activity row this was derived from, so a backfilled entry can be traced back
  -- and the backfill can be re-run without duplicating.
  "activityId" TEXT,
  "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "GradeChange_leadId_idx"    ON "GradeChange" ("leadId");
CREATE INDEX IF NOT EXISTS "GradeChange_changedAt_idx" ON "GradeChange" ("changedAt");
CREATE INDEX IF NOT EXISTS "GradeChange_source_idx"    ON "GradeChange" ("source");
-- One row per source activity: makes the backfill idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "GradeChange_activity_uq"
  ON "GradeChange" ("activityId") WHERE "activityId" IS NOT NULL;

COMMENT ON TABLE "GradeChange" IS
  'Every grade change, producer and system, with reason. Reports read this, not the activity feed (register A8).';
