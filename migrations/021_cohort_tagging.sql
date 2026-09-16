-- Cohort tagging, and the send facts a per-cohort report needs.
--
-- ── What a cohort is ─────────────────────────────────────────────────────────
-- The renewal week a lead belongs to, labelled by its MONDAY: '2026-11-09' means
-- 09 Nov – 15 Nov 2026. It is derived from "effectiveDate" and nothing else, so it is
-- stable, recomputable, and partitions every lead exactly once.
--
-- Frank names his pulls inclusively ("11/09/2026 to 11/16/2026"). Taken literally that
-- is eight days and consecutive pulls overlap on the shared Monday, which would put a
-- renewal in two cohorts and double-count it in any per-cohort total. The stored tag is
-- therefore the non-overlapping Monday-to-Sunday week. His reports keep taking an
-- explicit from/to range and are unaffected — this is a tag, not a replacement for the
-- report window. Every anchor he has used (10/05, 11/09, 11/16) is a Monday, so the
-- grid matches how he already works.
--
-- ── Why a trigger and not application code ───────────────────────────────────
-- "effectiveDate" is written from at least three places, two of them generic builders
-- that assemble columns from a payload object (buildInsert / buildApiUpdate in
-- storage.service.ts) plus the weekly pull's own UPDATE. A new write path would not
-- have to mention the cohort to change it, so any app-side derivation is guaranteed to
-- drift eventually. The trigger cannot be bypassed.
--
-- A GENERATED ALWAYS column was tried first and Postgres refuses it: to_date/to_char
-- are STABLE, not IMMUTABLE, and a generation expression must be immutable. Inside a
-- trigger that restriction does not apply.
--
-- The TypeScript mirror of this rule lives in src/services/cohort.ts. It exists for
-- labelling and filtering in the UI; THIS is the definition of record.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "cohort" TEXT;

CREATE OR REPLACE FUNCTION "lead_set_cohort"() RETURNS trigger AS $$
BEGIN
  -- Guarded: "effectiveDate" is TEXT and is not always a clean ISO date. A malformed
  -- value must leave the cohort NULL, never abort the write — losing a lead because its
  -- date was typed oddly would be far worse than an untagged one.
  IF NEW."effectiveDate" IS NOT NULL
     AND left(NEW."effectiveDate", 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    NEW."cohort" := to_char(
      date_trunc('week', to_date(left(NEW."effectiveDate", 10), 'YYYY-MM-DD')),
      'YYYY-MM-DD'
    );
  ELSE
    NEW."cohort" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fires on EVERY update, not just ones that touch "effectiveDate". Narrowing it to that
-- column looks tighter and leaves a hole: a write that set "cohort" directly would not
-- fire the trigger and would stick, which is the precise drift this design exists to
-- rule out. Recomputing one to_date per row update is not worth protecting against.
DROP TRIGGER IF EXISTS "lead_cohort_trg" ON "Lead";
CREATE TRIGGER "lead_cohort_trg"
  BEFORE INSERT OR UPDATE ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION "lead_set_cohort"();

-- Existing rows: the trigger only fires on write, so tag what is already there.
UPDATE "Lead"
   SET "cohort" = to_char(
         date_trunc('week', to_date(left("effectiveDate", 10), 'YYYY-MM-DD')),
         'YYYY-MM-DD')
 WHERE "effectiveDate" IS NOT NULL
   AND left("effectiveDate", 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   AND "cohort" IS DISTINCT FROM to_char(
         date_trunc('week', to_date(left("effectiveDate", 10), 'YYYY-MM-DD')),
         'YYYY-MM-DD');

CREATE INDEX IF NOT EXISTS "Lead_cohort_idx" ON "Lead" ("cohort");

-- ── What was actually sent ───────────────────────────────────────────────────
-- A per-cohort report has to answer "which mailbox sent this, under which cohort, and
-- what did it say". None of that is currently recoverable: the campaign's sequence can
-- be edited after the fact, so the copy a lead received is not the copy the campaign
-- holds today, and the platform picks the sending mailbox at send time.

-- Snapshot, NOT a join to "Lead"."cohort". A renewal date corrected next month must not
-- silently move a send that already happened into a different cohort's numbers.
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "cohort"            TEXT;

-- Which mailbox the platform actually sent from. Only known after the fact — it is not
-- our choice at push time — so it arrives from the sent webhook or the /emails feed.
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "sendingMailbox"    TEXT;

-- The copy as delivered, captured once and never refreshed.
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "emailSubject"      TEXT;
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "emailBody"         TEXT;
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "contentCapturedAt" TIMESTAMP;

-- Reports group by cohort and by mailbox; both are the whole point of the columns.
CREATE INDEX IF NOT EXISTS "OutreachEvent_cohort_idx"  ON "OutreachEvent" ("cohort");
CREATE INDEX IF NOT EXISTS "OutreachEvent_mailbox_idx" ON "OutreachEvent" ("sendingMailbox");

-- Superseded by "Lead"."cohort". It held the push FILTER ("2026-11-09..2026-11-16"),
-- which described the query someone ran rather than the lead, was only populated when
-- the filter happened to carry both ends of a range, and is NULL on every row in the
-- database. Left in place rather than dropped — dropping a column is not something to
-- do without being asked — but nothing writes it any more.
COMMENT ON COLUMN "Lead"."campaignCohort" IS
  'Superseded by "cohort" (migration 021). No longer written. Held the push filter range, not the lead''s cohort.';

-- There is a third similarly-named column. "cohortTag" is a declared-but-never-written
-- placeholder from the sourcing spec — NULL on all 9,938 rows, no code path sets it —
-- and it pairs with "sourceVendor", so it meant the vendor batch a lead arrived in, not
-- the renewal week. Left alone. Stated here because three columns with "cohort" in the
-- name is exactly how the wrong one ends up in a report.
COMMENT ON COLUMN "Lead"."cohortTag" IS
  'Vendor sourcing batch (placeholder, never populated). NOT the renewal week — that is "cohort" (migration 021).';
