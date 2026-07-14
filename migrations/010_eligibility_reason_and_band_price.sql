-- Frank Jul-2026 (Tue sync).
--
-- 1) Eligibility reason becomes STRUCTURED + nuance:
--      "travelersEligibilityReason"  → now holds a reason CODE (dropdown, reportable)
--      "travelersEligibilityDetail"  → free-text nuance for the one-off cases
--    "Dropdowns for things we can report on, text boxes for nuance."
--    Any pre-existing free-text in *Reason is moved to *Detail so nothing is lost.
--
-- 2) Indicative Band Price — the outreach hook. Producers set a discretionary band
--    from the rated Travelers/PM premiums; the email merges it ("we have you rated
--    at $725–$900"). Two columns so it merges cleanly and stays sortable.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "travelersEligibilityDetail" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "plymouthEligibilityDetail" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "indicativeBandLow"  NUMERIC(10,2);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "indicativeBandHigh" NUMERIC(10,2);

-- Preserve existing free-text reasons: move them into Detail, clear Reason so it can
-- hold a structured code. Only touches rows whose Reason is not already a code.
UPDATE "Lead"
SET "travelersEligibilityDetail" = COALESCE("travelersEligibilityDetail", "travelersEligibilityReason"),
    "travelersEligibilityReason" = NULL
WHERE "travelersEligibilityReason" IS NOT NULL
  AND "travelersEligibilityReason" <> ''
  AND "travelersEligibilityReason" !~ '^[a-z_]+$';

UPDATE "Lead"
SET "plymouthEligibilityDetail" = COALESCE("plymouthEligibilityDetail", "plymouthEligibilityReason"),
    "plymouthEligibilityReason" = NULL
WHERE "plymouthEligibilityReason" IS NOT NULL
  AND "plymouthEligibilityReason" <> ''
  AND "plymouthEligibilityReason" !~ '^[a-z_]+$';
