-- Frank Sep-2026: tell a blast-traced lead apart from one a producer traced by hand.
--
-- deepSkipTracedAt (015) already stops the blast re-tracing a lead — it skips anything
-- with that stamp — but it cannot say WHO spent the credit. A producer clicking the card
-- button and a 500-lead cohort run look identical after the fact, so nobody can audit a
-- run, report on it, or answer "what did the 9/11 blast actually get us".
--
--   blastSkipTracedAt  when the blast traced this lead (NULL = never blasted)
--   blastSkipTracedBy  who ran that blast
--   blastRunId         groups every lead from one run, so the QC report can show a run
--                      as a run (n, hits, credits) instead of a flat list of leads
--
-- Set only by the blast. The lead-card button leaves all three NULL, so
-- "blastSkipTracedAt IS NOT NULL" is the exact definition of "came from a blast".
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "blastSkipTracedAt" TIMESTAMP;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "blastSkipTracedBy" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "blastRunId" TEXT;

-- The QC report filters on the stamp and groups by run; both are sparse columns.
CREATE INDEX IF NOT EXISTS "Lead_blastSkipTracedAt_idx" ON "Lead" ("blastSkipTracedAt") WHERE "blastSkipTracedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Lead_blastRunId_idx" ON "Lead" ("blastRunId") WHERE "blastRunId" IS NOT NULL;
