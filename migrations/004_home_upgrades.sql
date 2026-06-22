-- Phase 5b (Frank, 2026-06-22) — Home Upgrades + basement finish. Additive, nullable, re-runnable.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "basementFinishedPct" TEXT,   -- % complete when foundation = basement
  ADD COLUMN IF NOT EXISTS "bathroomGrade"       TEXT,   -- Builders Grade | Semi-Custom | Custom | Designer
  ADD COLUMN IF NOT EXISTS "kitchenCount"        INTEGER,
  ADD COLUMN IF NOT EXISTS "kitchenGrade"        TEXT;   -- Builders Grade | Semi-Custom | Custom | Designer
