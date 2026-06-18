-- Phase 3a — FEMA NFHL flood integration (Frank, 2026-06-18). Additive, nullable, re-runnable.
-- Flood zone is now sourced from FEMA's National Flood Hazard Layer (by lat/long),
-- with a producer manual-override flag. Applied via scripts/run-migration.mjs.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "floodZoneSubtype" TEXT,      -- FEMA ZONE_SUBTY, e.g. '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'
  ADD COLUMN IF NOT EXISTS "floodSfha"        BOOLEAN,   -- FEMA SFHA_TF — true = Special Flood Hazard Area (high-risk)
  ADD COLUMN IF NOT EXISTS "floodZoneManual"  BOOLEAN,   -- true = producer override; FEMA enrichment won't overwrite
  ADD COLUMN IF NOT EXISTS "floodCheckedAt"   TEXT;      -- ISO timestamp of last FEMA lookup
