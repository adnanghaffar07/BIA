-- Frank Jun-2026: producers can override carrier eligibility (Eligible / Referral /
-- Non-eligible). When they change it from the system-computed value, they enter a
-- reason. These columns hold that free-text reason per carrier. Producer-entered —
-- never clobbered by REAPI re-ingest.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "travelersEligibilityReason" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "plymouthEligibilityReason" TEXT;
