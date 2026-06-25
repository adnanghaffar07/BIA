-- Frank Jun-2026: track producer edits separately from bulk pulls/enrichment.
-- `updatedAt` is bumped by REAPI pulls + enrichment, so it can't mark a human edit.
-- These columns are set ONLY by the detail-page save (PUT /api/leads/[id]) and
-- power the "Recently Edited" tab on the Lead Queue.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastEditedAt" TIMESTAMPTZ;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastEditedBy" TEXT;
