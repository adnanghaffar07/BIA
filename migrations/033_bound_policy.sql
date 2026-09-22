-- 033: recording a sale (directive Sec. 11.5 question 6 — the minimum viable ribbon).
--
-- Frank, 22 Sep 2026: "Hawksoft implementation or sync will not be required at this time.
-- We will track whether the account is sold manually in the card, same as the way we are
-- manually tracking other KPI items in the interim."
--
-- So the ribbon's first version is a person typing four fields. That is the right shape
-- at this volume: a handful of sales a week entered by hand gives a true conversion rate
-- on the 28th, where an integration gives the identical number in November.
--
-- ── What already existed ────────────────────────────────────────────────────
-- "boundPremium" and "boundDate" have been on Lead for months, and /api/leads/[id]
-- auto-stamps boundDate when status first moves to 'bound'. Nothing has ever used them:
-- zero leads carry either. What was missing is everything that identifies the policy —
-- which carrier wrote it, under what number, from when, and who recorded it. Without
-- those a bind is a number with no way to reconcile it against the agency's book, which
-- is precisely what the ribbon exists to make possible later.
--
-- ── Why the effective date is its own column ────────────────────────────────
-- "boundDate" is when WE recorded the sale. "boundEffectiveDate" is when cover starts.
-- They are usually days apart and answer different questions: the first measures the
-- outreach cycle, the second is what a renewal is counted from. Folding them together
-- would put next year's cohort in the wrong week.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "boundPolicyNumber"   TEXT,
  ADD COLUMN IF NOT EXISTS "boundCarrier"        TEXT,
  ADD COLUMN IF NOT EXISTS "boundEffectiveDate"  TEXT,
  ADD COLUMN IF NOT EXISTS "boundBy"             TEXT,
  ADD COLUMN IF NOT EXISTS "boundNotes"          TEXT;

-- Conversion reporting reads "every bind in a date range", which is a range scan over a
-- small subset of a 9,937-row table. Partial so the index holds only the sold leads
-- rather than a null for every lead that never will be.
CREATE INDEX IF NOT EXISTS "Lead_bound_idx"
    ON "Lead" ("boundDate")
 WHERE "boundDate" IS NOT NULL;

-- Reconciling our record against the agency's book means looking a policy number up.
-- Not unique: a correction re-entered on the right lead after being typed on the wrong
-- one would collide, and refusing the correction is worse than allowing the duplicate,
-- which a report can show.
CREATE INDEX IF NOT EXISTS "Lead_boundPolicy_idx"
    ON "Lead" (LOWER("boundPolicyNumber"))
 WHERE "boundPolicyNumber" IS NOT NULL;
