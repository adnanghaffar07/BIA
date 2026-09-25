-- The recapture record (Frank's directive, 24 Sep 2026 · second email, §3 fixes 17, 19, 22)
--
-- 17. "'Recaptured' becomes its own status, never 'new', carrying the date and which
--     process returned it."
-- 19. "Cohort populations freeze when the send list is built; later recaptures go to a
--     holding pool."
-- 22. "Recapture Log tab — date, cohort, accounts affected, process, whether Ruben was
--     notified."
--
-- ── What already exists, and is deliberately not duplicated ─────────────────
-- Lead."recoveredAt" and Lead."recoveredBy" already carry the date and the process for all
-- 34 recaptured accounts. Adding recapturedAt/recapturedBy beside them would create two
-- columns answering one question, which is the defect this project keeps paying for. They
-- are read, not replaced.
--
-- The holding pool is likewise NOT a column. A cohort is frozen once any lead in it carries
-- "sendListBuiltAt"; a lead in a frozen cohort without that stamp is, by definition, an
-- arrival after the freeze. Storing a flag as well would let the flag and the stamp disagree,
-- and then the argument is about which one is right.
--
-- ── What genuinely has no home ──────────────────────────────────────────────
-- Whether Ruben was told. Nothing on the Lead records that, it cannot be derived from
-- anything, and fix 21 turns on it. That is what this table is for: one row per recapture
-- event, holding what was true at the moment it happened.
--
-- It is an append-only event log. The Lead columns say what an account IS; this says what
-- happened to it and when — which is the question "did this cohort grow after we froze it"
-- actually asks, and no current-state column can answer it.

CREATE TABLE IF NOT EXISTS "RecaptureLog" (
  "id"            TEXT PRIMARY KEY,
  "leadId"        TEXT NOT NULL,
  "propertyId"    TEXT,

  -- The renewal week the account belonged to WHEN IT CAME BACK. Copied, not joined: a lead
  -- re-dated later would otherwise rewrite the history of a week that already reported.
  "cohort"        TEXT,

  "recapturedAt"  TIMESTAMP NOT NULL,

  -- Which process returned it: tracerfy | batchdata | grade_change | manual.
  -- Frank asked for the process by name because "it came back" and "Tracerfy found an
  -- address for it" are different facts, and only one of them can be checked.
  "process"       TEXT NOT NULL,

  -- What the account read as immediately before. Fix 17's real complaint is that a
  -- recaptured account shows as New and looks unworked; this preserves the answer to
  -- "what was it before" so that can never be lost, whatever the card chooses to display.
  "priorStatus"   TEXT,
  "priorGrade"    TEXT,
  "newGrade"      TEXT,

  -- True when the cohort's send list was already built. Evaluated once, at the moment of
  -- the event, and stored: the send list can be rebuilt, and a held account must not stop
  -- reading as held because the world moved on around it.
  "heldFromCohort" BOOLEAN NOT NULL DEFAULT FALSE,

  -- Fix 21. NULL means nobody has told Ruben yet, which is the whole point of the column.
  "rubenNotifiedAt" TIMESTAMP,
  "notifiedBy"      TEXT,

  "note"          TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The tab reads by date, the holding pool by cohort, and the daily report by "not yet told".
CREATE INDEX IF NOT EXISTS "RecaptureLog_recapturedAt_idx" ON "RecaptureLog" ("recapturedAt" DESC);
CREATE INDEX IF NOT EXISTS "RecaptureLog_cohort_idx"       ON "RecaptureLog" ("cohort");
CREATE INDEX IF NOT EXISTS "RecaptureLog_lead_idx"         ON "RecaptureLog" ("leadId");
CREATE INDEX IF NOT EXISTS "RecaptureLog_unnotified_idx"
  ON "RecaptureLog" ("recapturedAt") WHERE "rubenNotifiedAt" IS NULL;

-- One row per lead per process. A blast that reruns over the same lead must not log it
-- twice: the account came back once, and a duplicate would inflate every count on the tab.
CREATE UNIQUE INDEX IF NOT EXISTS "RecaptureLog_lead_process_key"
  ON "RecaptureLog" ("leadId", "process");

COMMENT ON TABLE "RecaptureLog" IS
  'One row per account returning to play. Append-only. Holds what was true at the moment of the recapture, including whether the cohort had already been frozen and whether Ruben was told (Frank, 24 Sep 2026).';
