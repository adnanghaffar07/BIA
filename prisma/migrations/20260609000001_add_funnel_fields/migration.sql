-- ── §10A: Lead Identity & Sourcing ──────────────────────────────────────────
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "sourceVendor"   TEXT NOT NULL DEFAULT 'reapi',
  ADD COLUMN IF NOT EXISTS "cohortTag"      TEXT;

-- ── §10B: Rating readiness ────────────────────────────────────────────────────
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "roofYear"           INTEGER,
  ADD COLUMN IF NOT EXISTS "constructionType"   TEXT,
  ADD COLUMN IF NOT EXISTS "protectionClass"    TEXT,
  ADD COLUMN IF NOT EXISTS "priorCarrier"       TEXT,
  ADD COLUMN IF NOT EXISTS "priorPremium"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "indicativeBasis"    TEXT;

-- ── §10D: Producer workflow timestamps ───────────────────────────────────────
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "queueEnteredAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstRpcAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contactAttempts"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "authorizationMethod" TEXT;

-- ── §10E: Quote, bind & variance loop (the Moat) ─────────────────────────────
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "posQuotePremium" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "quotedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "variancePct"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "lostReason"      TEXT,
  ADD COLUMN IF NOT EXISTS "lostStage"       TEXT;

-- Back-fill sourceVendor for existing rows already set to default via ALTER above.
-- Back-fill queueEnteredAt for all existing Grade-A leads (they are already in the queue).
UPDATE "Lead"
SET "queueEnteredAt" = "createdAt"
WHERE "grade" = 'A' AND "queueEnteredAt" IS NULL;
