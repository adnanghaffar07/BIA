-- Frank Jul-2026: verify the insured name against the municipal tax roll.
--
-- Stores the OUTCOME of a check, independent of how the record was obtained
-- (portal lookup, a township-supplied extract, or a producer pasting it in) — so
-- none of this is tied to scraping any particular site.
--
--   ownerVerifyStatus  match | partial | mismatch | unknown   (see ownerNameMatch.service)
--   ownerVerifyName    the name exactly as the tax roll shows it, e.g. "BRUMMER, THERESA"
--   ownerVerifySource  where it came from — 'howell_portal', 'marlboro_portal', 'manual', ...
--   ownerVerifyAt      when it was checked (results are cached; we never re-query needlessly)
--   ownerVerifyDetail  human-readable explanation shown in the tooltip / QC report
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ownerVerifyStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ownerVerifyName"   TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ownerVerifySource" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ownerVerifyAt"     TIMESTAMPTZ;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ownerVerifyDetail" TEXT;
