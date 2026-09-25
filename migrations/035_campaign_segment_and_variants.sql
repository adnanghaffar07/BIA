-- Segment and test-arm assignment (Frank's directive, 24 Sep 2026 · §3, §6.1, §6.2)
--
-- "Segment is written to the lead record and stamped on every send and every response. It
-- is never inferred at report time. If a figure crosses two segments, it does not go in a
-- report."
--
-- ── Why these live on the lead and not only on the send ─────────────────────
-- A reply recorded without knowing which version produced it can never be attributed
-- afterwards — that information does not exist later. So the assignment is made once, when
-- the list is built, and everything downstream copies it rather than deciding again.
--
-- ── Why per person rather than per household ────────────────────────────────
-- §3: "Per person, at random, balanced within each cohort." The insured and the co-insured
-- are two readers and two chances to learn something, so each carries their own arm. They
-- are separate columns rather than a second table because a lead has exactly two possible
-- recipients and never more — §1.5 caps it at two addresses per household.
--
-- ── Why the arm is fixed for the whole sequence ─────────────────────────────
-- One person keeps the same subject and CTA arm across emails 1, 2 and 3. Re-randomising
-- per step would mean a reader receiving arm 1 then arm 2, and every result would describe
-- a mixture rather than either arm.

ALTER TABLE "Lead"
  -- 'rated' · 'unrated' · 'grade_b'. Decided from a PRODUCER-entered premium, never from
  -- enrichment data, and never from the status column, which the skip-trace blast rewrites.
  ADD COLUMN IF NOT EXISTS "campaignSegment"        TEXT,
  ADD COLUMN IF NOT EXISTS "campaignSegmentAt"      TIMESTAMP,
  -- 'A' or 'B' — which subject line. 1 or 2 — which call-to-action arm.
  ADD COLUMN IF NOT EXISTS "insuredSubjectVariant"  TEXT,
  ADD COLUMN IF NOT EXISTS "insuredCtaArm"          SMALLINT,
  ADD COLUMN IF NOT EXISTS "coInsuredSubjectVariant" TEXT,
  ADD COLUMN IF NOT EXISTS "coInsuredCtaArm"        SMALLINT,
  -- When the list was built. Frank's fix 3: "Cohort populations freeze when the send list
  -- is built. Later recaptures go to a holding pool, not into a campaign in flight."
  ADD COLUMN IF NOT EXISTS "sendListBuiltAt"        TIMESTAMP;

-- Stamped on the send itself, so a response can be traced to one version without joining
-- back to a lead record that may since have been re-graded, recaptured or re-rated.
ALTER TABLE "OutreachEvent"
  ADD COLUMN IF NOT EXISTS "segment"        TEXT,
  ADD COLUMN IF NOT EXISTS "versionLabel"   TEXT,
  ADD COLUMN IF NOT EXISTS "subjectVariant" TEXT,
  ADD COLUMN IF NOT EXISTS "ctaVariant"     TEXT,
  -- §6.3: the PAUSE formula has to evaluate per domain. The send log had no domain column,
  -- so one domain burning inside a healthy average could never trip it.
  ADD COLUMN IF NOT EXISTS "sendingDomain"  TEXT;

-- Reporting always slices by segment, and §6.1 forbids blending them.
CREATE INDEX IF NOT EXISTS "Lead_campaignSegment_idx"
  ON "Lead" ("campaignSegment", "cohort");

-- The per-version and per-domain reads the Daily Send Log and Test Results tabs need.
CREATE INDEX IF NOT EXISTS "OutreachEvent_segment_version_idx"
  ON "OutreachEvent" ("segment", "versionLabel");
CREATE INDEX IF NOT EXISTS "OutreachEvent_domain_idx"
  ON "OutreachEvent" ("sendingDomain", "sentAt" DESC);

COMMENT ON COLUMN "Lead"."campaignSegment" IS
  'rated | unrated | grade_b. From a producer-entered premium only. Never inferred at report time.';
COMMENT ON COLUMN "Lead"."insuredCtaArm" IS
  'Test arm for the insured, fixed across all three emails so results describe one arm rather than a mixture.';
COMMENT ON COLUMN "OutreachEvent"."sendingDomain" IS
  'The domain that sent it. Without this the PAUSE rule can only see a whole day, and one burning domain hides inside a healthy average.';
