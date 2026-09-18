-- 027: the contact-recovery pipeline (Frank, 18 Sep 2026)
--
-- An isolated lead — Grade A, no insured email — moves through two vendors in order:
--   Tracerfy deep trace  →  BatchData  →  exhausted
--
-- WHY A RECORDED STAGE RATHER THAN A DERIVED ONE
-- The stage could be inferred (deepSkipTracedAt set = Tracerfy ran, skipTraceData.provider
-- = 'batchdata' = BatchData ran), but inference breaks the moment a lead is traced for
-- some other reason, and the QC tabs are counted ON this. A tab whose population is
-- guessed is a tab whose numbers get argued about — which is the entire history of this
-- project. The stage is written when it changes and read literally.
--
-- Every attempt is stamped separately so "we ran Tracerfy and it found nothing" is
-- distinguishable from "we never ran Tracerfy", which the pipeline depends on and which
-- deepSkipTracedAt alone cannot express.

ALTER TABLE "Lead"
  -- 'isolated'   — in the pool, no vendor attempted yet
  -- 'tracerfy'   — Tracerfy ran and found nothing usable; BatchData is next
  -- 'batchdata'  — BatchData also found nothing; exhausted
  -- 'recovered'  — a vendor returned contact details and the lead is back
  ADD COLUMN IF NOT EXISTS "recoveryStage"       TEXT,
  ADD COLUMN IF NOT EXISTS "recoveryEnteredAt"   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "recoveryTracerfyAt"  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "recoveryBatchDataAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "recoveredAt"         TIMESTAMP,
  -- Which vendor actually produced the contact details, so the two tools can be compared
  -- on recovery rate rather than on impression.
  ADD COLUMN IF NOT EXISTS "recoveredBy"         TEXT,
  -- What came back, so "how many got a phone vs an email" is answerable per lead.
  ADD COLUMN IF NOT EXISTS "recoveredEmail"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "recoveredPhone"      BOOLEAN;

CREATE INDEX IF NOT EXISTS "Lead_recoveryStage_idx" ON "Lead" ("recoveryStage")
  WHERE "recoveryStage" IS NOT NULL;
