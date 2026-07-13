-- Frank Jul-2026: REAPI sometimes classifies a single-family home as a CONDO (or
-- vice-versa). For now we don't auto-correct — producers flag the discrepancy so we
-- can watch the volume (QC → Type Mismatch report). Producer-set, never clobbered.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "propertyTypeMismatch" BOOLEAN DEFAULT false;
