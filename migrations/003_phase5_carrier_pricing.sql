-- Phase 5 (Frank, 2026-06-18) — editable carrier pricing + close-out controls.
-- Additive, nullable, re-runnable. Applied via scripts/run-migration.mjs.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "travelersPremium" REAL,     -- producer-entered Travelers indicative $
  ADD COLUMN IF NOT EXISTS "plymouthPremium"  REAL,     -- producer-entered Plymouth Rock indicative $
  ADD COLUMN IF NOT EXISTS "assignedCarrier"  TEXT,     -- 'travelers' | 'plymouth' — the cheaper/front-runner
  ADD COLUMN IF NOT EXISTS "doNotRevisit"     BOOLEAN;  -- close-out: explicitly do NOT revisit next year
