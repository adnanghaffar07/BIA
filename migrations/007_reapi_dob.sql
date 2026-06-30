-- Frank Jun-2026: skip-trace returns the insured's AGE (not a birth date).
-- Store the REAPI-derived DOB for the person whose name matches the Insured Name:
--   year is exact (this year − age); month/day are assumed (Jan 1) and flagged
--   "(est.)" in the UI. reapiAge keeps the raw age for transparency.
-- Set ONLY by the skip-trace route — never by REAPI bulk re-ingest or producer edits.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "reapiDob" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "reapiAge" INTEGER;
