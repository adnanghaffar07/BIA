-- The skip-trace blast queue (Frank 28 Sep: Grade B mass trace; Abdullah 28 Sep: move
-- the filtered leads into the blast and keep A and B apart).
--
-- ── Why a queue and not a filter ────────────────────────────────────────────
-- The blast runs off the Leads page's filter set, so its population is re-derived from
-- filters every time. The Grade-B roof report cannot be expressed that way: its population
-- is "Grade B, roof year unknown, house 21-76 years old", and home age is not a Leads
-- filter. Handing the blast a grade and a date range would run it over a different and much
-- larger population than the one on screen — 3,482 leads rather than the 2,681 selected.
--
-- So the selection is recorded against the leads themselves. What was queued is a fact,
-- not a query that might mean something different tomorrow.
--
-- ── Why the grade is stored rather than read ────────────────────────────────
-- blastQueueGrade is the queue a lead was PUT IN, which is not the same as the grade it
-- carries now. A lead re-graded between queuing and running would silently move between the
-- two blasts, and the A and B runs have different economics: a Grade A trace is chasing an
-- address for an account with a band price ready to send, a Grade B trace is speculative.
-- Frank asked for them separated; separating them on a value that can change underneath is
-- not separating them.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "blastQueuedAt"    timestamp,
  ADD COLUMN IF NOT EXISTS "blastQueuedBy"    text,
  ADD COLUMN IF NOT EXISTS "blastQueueGrade"  text,
  ADD COLUMN IF NOT EXISTS "blastQueueReason" text;

-- The queue is always read as "everything waiting in grade X", so the grade leads.
CREATE INDEX IF NOT EXISTS "Lead_blast_queue_idx"
  ON "Lead" ("blastQueueGrade", "blastQueuedAt")
  WHERE "blastQueuedAt" IS NOT NULL;

COMMENT ON COLUMN "Lead"."blastQueuedAt" IS
  'When this lead was put in the skip-trace blast queue. NULL means not queued. Cleared when the blast traces it.';
COMMENT ON COLUMN "Lead"."blastQueueGrade" IS
  'Which queue: A or B. The grade AT QUEUE TIME, deliberately not re-read from the lead.';
