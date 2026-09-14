-- Keep EVERY contact a skip trace returns, not just the first two.
--
-- The lead has phone1/phone2 and email1/email2, so a trace that found six emails wrote
-- two and dropped four. Measured across 896 traces in this database: 43.4% returned more
-- than two emails, and 1,049 emails plus 1,622 phone numbers were discarded — all of them
-- already paid for at 15 credits per matched trace.
--
-- Nothing was actually lost: the full lists went into Activity.metadata at trace time, so
-- the backfill below recovers them without re-tracing and without spending a credit.
--
-- These columns are ADDITIVE. phone1/2 and email1/2 keep their current meaning as the
-- primary contacts a producer works from, and the ordering here matches them — element 0
-- is email1, element 1 is email2 — so nothing that reads the existing columns changes.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "emailsAll" JSONB;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "phonesAll" JSONB;

-- Backfill from the most recent matched skip trace per lead.
--
-- Most recent rather than merged-across-traces: a later trace supersedes an earlier one,
-- and merging would resurrect addresses a re-trace deliberately stopped returning.
WITH latest AS (
  SELECT DISTINCT ON ("leadId")
    "leadId",
    "metadata"->'emails' AS emails,
    "metadata"->'phones' AS phones
  FROM "Activity"
  WHERE "type" = 'skip_trace'
    AND "metadata" ? 'emails'
  ORDER BY "leadId", "createdAt" DESC
)
UPDATE "Lead" l
SET "emailsAll" = latest.emails,
    "phonesAll" = latest.phones
FROM latest
WHERE l."id" = latest."leadId"
  AND l."emailsAll" IS NULL;

-- Leads whose contacts were typed in by a producer rather than traced have no activity
-- row to recover from. Seed those from the columns they do have, so a consumer can read
-- one field instead of special-casing "traced" against "entered by hand".
UPDATE "Lead"
SET "emailsAll" = to_jsonb(ARRAY(
      SELECT DISTINCT e FROM unnest(ARRAY["email1", "email2", "owner2Email"]) AS e
      WHERE e IS NOT NULL AND e <> ''))
WHERE "emailsAll" IS NULL
  AND (COALESCE("email1",'') <> '' OR COALESCE("email2",'') <> '' OR COALESCE("owner2Email",'') <> '');

UPDATE "Lead"
SET "phonesAll" = to_jsonb(ARRAY(
      SELECT DISTINCT p FROM unnest(ARRAY["phone1", "phone2", "owner2Phone"]) AS p
      WHERE p IS NOT NULL AND p <> ''))
WHERE "phonesAll" IS NULL
  AND (COALESCE("phone1",'') <> '' OR COALESCE("phone2",'') <> '' OR COALESCE("owner2Phone",'') <> '');
