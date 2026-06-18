-- Phase 1 — Frank feedback (2026-06-18): additive, nullable columns only.
-- Safe to re-run: every clause is ADD COLUMN IF NOT EXISTS (no backfill, no data loss).
-- Applied to the Neon "Lead" table via scripts/run-migration.mjs.

ALTER TABLE "Lead"
  -- Contacts / insurance-score inputs (both named insureds + DOB)
  ADD COLUMN IF NOT EXISTS "owner2FirstName"      TEXT,
  ADD COLUMN IF NOT EXISTS "owner2LastName"       TEXT,
  ADD COLUMN IF NOT EXISTS "maritalStatus"        TEXT,     -- 'married' | 'single' | 'unknown'
  ADD COLUMN IF NOT EXISTS "owner1Dob"            TEXT,     -- ISO date; skip-trace or call
  ADD COLUMN IF NOT EXISTS "owner2Dob"            TEXT,

  -- Confirm-on-call (human Q&A, unknown until first contact)
  ADD COLUMN IF NOT EXISTS "dogBreed"             TEXT,     -- restricted-breed name | 'none' | null=unknown
  ADD COLUMN IF NOT EXISTS "insuranceHistory"     TEXT,     -- 'currently_insured'(assumed) | 'lapsed' | 'new' | 'unknown'
  ADD COLUMN IF NOT EXISTS "heatingRenovatedYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "bathroomsFull"        INTEGER,
  ADD COLUMN IF NOT EXISTS "bathroomsHalf"        INTEGER,

  -- Home features (listing-sourced or manual; default heat = gas for NJ)
  ADD COLUMN IF NOT EXISTS "garageType"           TEXT,     -- 'attached' | 'detached' | 'none'
  ADD COLUMN IF NOT EXISTS "garageCount"          INTEGER,
  ADD COLUMN IF NOT EXISTS "sidingType"           TEXT,
  ADD COLUMN IF NOT EXISTS "foundationType"       TEXT,     -- 'basement' | 'crawl_space' | 'slab'
  ADD COLUMN IF NOT EXISTS "heatSource"           TEXT,
  ADD COLUMN IF NOT EXISTS "feetFromHydrant"      INTEGER,

  -- Travelers "Home Features" protective devices
  ADD COLUMN IF NOT EXISTS "burglarAlarm"         TEXT,     -- 'local' | 'smart' | 'central' | 'none'
  ADD COLUMN IF NOT EXISTS "fireAlarm"            TEXT,     -- 'local' | 'central' | 'none'
  ADD COLUMN IF NOT EXISTS "sprinklerSystem"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "smokeDetector"        TEXT,     -- 'regular' | 'smart' | 'none'
  ADD COLUMN IF NOT EXISTS "waterSensor"          TEXT,     -- 'regular' | 'smart' | 'central' | 'none'
  ADD COLUMN IF NOT EXISTS "autoWaterShutoff"     TEXT,     -- 'regular' | 'smart' | 'none'
  ADD COLUMN IF NOT EXISTS "lowTempSensor"        TEXT,     -- 'regular' | 'smart' | 'central' | 'none'
  ADD COLUMN IF NOT EXISTS "leedCertified"        BOOLEAN,

  -- Effective date (tied to new-purchase / renewal 90-day logic)
  ADD COLUMN IF NOT EXISTS "effectiveDate"        TEXT;
