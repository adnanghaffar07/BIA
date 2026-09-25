-- The run log (Frank's directive, 24 Sep 2026 · second email, §3 fix 20)
--
-- "Skip-trace runs and grading changes logged in real time, with cohort, account count and
--  process."
--
-- ── What exists, and why it is not enough ───────────────────────────────────
-- Every lead a blast touches gets an Activity row, and every grade change gets a GradeChange
-- row. So the per-ACCOUNT history is complete. What does not exist anywhere is the RUN: who
-- pressed the button, over which weeks, how many accounts were in the pool, how many were
-- actually called, and how many came back.
--
-- That gap is not cosmetic. A run over a pool of 47 that recovers 3 and a run over a pool of
-- 3 that recovers 3 leave identical traces — three Activity rows — and they mean opposite
-- things. Deriving runs by grouping Activity rows by timestamp cannot tell them apart,
-- because the 44 that returned nothing were never written anywhere.
--
-- A run that finds nothing at all leaves NO trace by that method. It is invisible, and
-- "we traced that week and got nothing" is indistinguishable from "nobody ever traced it" —
-- which is the confusion that had the 11/09 week sitting untouched with 47 leads waiting.
--
-- ── Why "in real time" means a row at the START ─────────────────────────────
-- The row is written when the run begins, not when it ends. A run that is still going, and a
-- run that died half way through a vendor call, both have to be visible — those are exactly
-- the moments somebody asks what is happening. A log written only on success is a log that
-- goes quiet precisely when it is needed.

CREATE TABLE IF NOT EXISTS "ProcessRun" (
  "id"          TEXT PRIMARY KEY,

  -- tracerfy_blast | batchdata_blast | regrade | send_list_build | enrichment | pull
  "process"     TEXT NOT NULL,

  "startedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "finishedAt"  TIMESTAMP,

  -- running | ok | failed | aborted. Defaults to running, because that is what it is the
  -- moment the row is written, and a crash leaves it saying so rather than saying nothing.
  "outcome"     TEXT NOT NULL DEFAULT 'running',

  -- The renewal weeks the run was pointed at. Frank reads and writes in C1…C7, so the
  -- window is stored rather than left to be inferred from whatever the run happened to hit.
  "cohortFrom"  TEXT,
  "cohortTo"    TEXT,

  -- The three counts that make a run readable, and they are not interchangeable:
  --   considered — everything that qualified for this run
  --   touched    — what it actually reached (a limit, a skip rule or a failure cuts this down)
  --   changed    — what came out different
  -- One number cannot stand for the three. "3 recovered" is a good day out of 3 and a bad
  -- one out of 47.
  "considered"  INTEGER,
  "touched"     INTEGER,
  "changed"     INTEGER,

  -- The same three, per renewal week. Frank asked for "cohort" alongside the count, and a
  -- single total across seven weeks cannot answer which week is behind.
  "byCohort"    JSONB,

  "runBy"       TEXT,

  -- A dry run is a real run and is logged as one. Leaving them out would make the log
  -- disagree with the vendor's own bill, and someone would eventually reconcile the two.
  "dryRun"      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Whatever else the run computed — skipped, entity-owned, per-vendor splits, cost.
  -- Free-form on purpose: every process has a different shape and forcing them into shared
  -- columns would mean a column per process that is null for all the others.
  "detail"      JSONB,

  "error"       TEXT,

  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ProcessRun_startedAt_idx" ON "ProcessRun" ("startedAt" DESC);
CREATE INDEX IF NOT EXISTS "ProcessRun_process_idx"   ON "ProcessRun" ("process", "startedAt" DESC);
-- The panel's "is anything running right now" question.
CREATE INDEX IF NOT EXISTS "ProcessRun_running_idx"
  ON "ProcessRun" ("startedAt" DESC) WHERE "outcome" = 'running';

COMMENT ON TABLE "ProcessRun" IS
  'One row per batch process run, written when it STARTS and updated when it ends. Holds the window, the three counts and the per-cohort split (Frank, 24 Sep 2026, fix 20).';
COMMENT ON COLUMN "ProcessRun"."considered" IS
  'Everything that qualified. Not the same as touched: a limit or a skip rule cuts the pool down, and the difference is what says whether a week is finished.';
