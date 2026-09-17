-- Two things the Grade A Outreach Playbook (locked 9/14) requires before the first send,
-- neither of which exists today.
--
-- ── 1. The 10% holdout (§00, "non-negotiable") ───────────────────────────────
-- "Without it we cannot tell binds the campaign caused from binds that would have
-- happened anyway."
--
-- "holdoutFlag" already exists and the push already refuses to mail a lead carrying it —
-- but it is NOT NULL DEFAULT false, so all 9,937 rows read "not held out" and nothing
-- distinguishes a lead deliberately assigned to the treatment group from one that was
-- never put through the assignment at all. An experiment whose control group cannot be
-- told apart from unprocessed rows is not an experiment.
--
-- holdoutAssignedAt is what makes the assignment real: set once, never recomputed, so the
-- split can be audited afterwards and cannot silently drift between runs.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "holdoutAssignedAt" TIMESTAMP;
-- Which cohort the lead was stratified within. Stored rather than derived because a
-- renewal date corrected later must not move a lead between experiment strata after the
-- fact — that would change the denominator of a result already reported.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "holdoutCohort" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_holdout_idx" ON "Lead" ("holdoutFlag", "holdoutCohort");

-- ── 2. Band accuracy (§03) ───────────────────────────────────────────────────
-- "The CRM computes variancePct as the POS quote against expectedPremium — the rule-based
-- 0.5%-of-value estimate. The customer never sees expectedPremium. They see
-- indicativeBandLow and indicativeBandHigh, in writing, in email 2. These are two
-- disconnected pricing systems, and no code anywhere compares the band we published to
-- the premium we bound."
--
-- The band is already handed to the sending platform as a merge variable, so the figure
-- the homeowner reads is decided at push time — and then forgotten. These columns are the
-- record of what was actually published.
--
-- "There is no retrofitting it, because the dataset only starts accumulating the day the
-- first band leaves." Nothing has been sent yet, so this lands just in time.

-- Per SEND: the exact numbers that went out in that email. Per-send rather than per-lead
-- because a lead can be mailed again next cycle at a different valuation, and the question
-- is always "was the band THEY SAW right".
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "publishedBandLow"  NUMERIC;
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "publishedBandHigh" NUMERIC;

-- Per LEAD: the FIRST band this household was ever shown, and the verdict once bound.
-- Kept on the lead as well so the hit rate is one query rather than a join through the
-- send log, and so it survives a send being deleted at the vendor.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "publishedBandLow"  NUMERIC;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "publishedBandHigh" NUMERIC;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "publishedBandAt"   TIMESTAMP;

-- The verdict. bandHit is TRUE when the bound premium landed inside the published band.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bandHit" BOOLEAN;
-- Signed distance from the nearest edge of the band, as a percentage of that edge.
-- Negative = bound BELOW the band (we quoted high), positive = ABOVE (we quoted low).
-- Zero when inside. Signed because "the misses ran high on older Coverage A" is exactly
-- the kind of conclusion §03 expects this data to support, and an absolute value hides it.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bandVariancePct" DOUBLE PRECISION;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "bandMeasuredAt"  TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Lead_bandHit_idx" ON "Lead" ("bandHit");

COMMENT ON COLUMN "Lead"."variancePct" IS
  'POS quote vs expectedPremium (internal estimate the customer never sees). NOT band accuracy — that is bandVariancePct (migration 022, playbook §03).';
