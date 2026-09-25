-- The daily retroactive-change notice (Frank, 24 Sep 2026 · second email, §3 fix 21)
--
-- "No retroactive change to a worked account without notifying Ruben — daily report of what
--  changed."
--
-- ── What the rule is actually about ─────────────────────────────────────────
-- Ruben works an account: he rates it, he calls it, he quotes it. Afterwards something the
-- machine does changes it underneath him — a re-grade drops it out of his queue, a trace
-- rewrites its status, an enrichment pass flips its eligibility. He finds out by opening a
-- card he already worked and finding it different, with nothing saying when or why.
--
-- It is not hypothetical. On 22 Sep a single re-grading pass changed 28 accounts that had
-- already been worked, in one day, and nothing told anybody.
--
-- ── Why this table holds a DIGEST, not the changes ──────────────────────────
-- The changes themselves already exist: GradeChange has every grade that moved with its
-- source, RecaptureLog has every account that came back, Activity has the rest. Copying them
-- here would create a second version of the same history, free to disagree with the first.
--
-- What does not exist anywhere, and cannot be derived, is whether anyone TOLD Ruben. That is
-- the only new fact, and it is what this table stores: one row per day, saying what that day
-- contained and whether it went out.
--
-- ── Why one row per DAY ─────────────────────────────────────────────────────
-- Because Frank asked for a daily report, and because the unit he will ask about is the day:
-- "was Ruben told about Tuesday". A per-change flag answers a question nobody asks and
-- leaves the daily report itself unrecorded — so a day where the job never ran would look
-- exactly like a day where nothing changed.

CREATE TABLE IF NOT EXISTS "RetroNotice" (
  "id"            TEXT PRIMARY KEY,

  -- The day the changes happened, not the day the notice was built. A notice generated late
  -- still describes its own day, and a re-run must land on the same row.
  "day"           DATE NOT NULL,

  "generatedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),

  -- The counts, so the tab reads without opening the payload.
  "changeCount"   INTEGER NOT NULL DEFAULT 0,
  "accountCount"  INTEGER NOT NULL DEFAULT 0,

  -- The changes as they stood when the notice was built, frozen.
  --
  -- A snapshot rather than a live query on purpose, and it is the one place a copy is
  -- justified: this is the evidence of what Ruben was actually told. Re-deriving it later
  -- would show what the history says TODAY, which is a different thing and exactly the sort
  -- of quiet substitution this whole fix exists to stop.
  "payload"       JSONB,

  -- NULL means it has not gone out. That is the column the rule turns on.
  "sentAt"        TIMESTAMP,
  "sentTo"        TEXT,
  "sentBy"        TEXT,
  -- How it reached him: 'in_app' | 'email' | 'manual'. There is no internal mail channel in
  -- this application yet, so early rows will say in_app or manual.
  "method"        TEXT,

  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One notice per day. A re-run updates its day's row rather than adding a second, so the
-- question "was Ruben told about Tuesday" always has exactly one answer.
CREATE UNIQUE INDEX IF NOT EXISTS "RetroNotice_day_key" ON "RetroNotice" ("day");
-- The nag: days that had something to report and never went out.
CREATE INDEX IF NOT EXISTS "RetroNotice_unsent_idx"
  ON "RetroNotice" ("day" DESC) WHERE "sentAt" IS NULL;

COMMENT ON TABLE "RetroNotice" IS
  'One row per day of retroactive changes to worked accounts. Holds the frozen payload and whether Ruben was told — the only fact here that cannot be derived from GradeChange, RecaptureLog and Activity (Frank, 24 Sep 2026, fix 21).';
