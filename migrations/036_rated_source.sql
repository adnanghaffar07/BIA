-- Where a premium came from (Frank's directive, 24 Sep 2026 · second email, §3 fix 2)
--
-- "The rated flag gets a source — producer-entered and enrichment-populated in separate
-- fields, never merged."
--
-- ── What prompted it ────────────────────────────────────────────────────────
-- Frank saw an enrichment run filling Travelers, Plymouth Rock and flood fields on an
-- account, and asked whether the rated flag reads the same fields enrichment writes: "If
-- the rated flag reads the same fields enrichment writes to, accounts are being marked
-- rated that nobody rated — and they would receive a band price that doesn't exist."
--
-- ── What the data actually says ─────────────────────────────────────────────
-- Enrichment writes eligibility and flood, NOT the premium columns, so the specific fear
-- does not hold. But of 778 accounts carrying a carrier premium, 709 have an activity row
-- showing a producer saving the card and 69 have no trace of any kind. Nothing on the
-- record tells those two groups apart, which is the real gap and the one this closes.
--
-- ── Why a source column rather than separate premium columns ────────────────
-- Frank asked for separate fields. Separate premium columns would mean every reader — the
-- ledger, the dashboard, the segment build, the lead card — learning to check two places
-- and coalesce them, and the first reader to forget silently reintroduces the merge. One
-- premium with a recorded source cannot be read ambiguously: either it says who entered it
-- or it admits it does not know.

ALTER TABLE "Lead"
  -- 'producer' = a person typed it into the card. 'system' = anything else wrote it.
  -- NULL = we cannot tell, which is a third answer and must never read as either of the
  -- other two.
  ADD COLUMN IF NOT EXISTS "ratedSource" TEXT,
  ADD COLUMN IF NOT EXISTS "ratedAt"     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "ratedBy"     TEXT;

-- The segment build and the QC reports both filter on this.
CREATE INDEX IF NOT EXISTS "Lead_ratedSource_idx"
  ON "Lead" ("ratedSource") WHERE "ratedSource" IS NOT NULL;

COMMENT ON COLUMN "Lead"."ratedSource" IS
  'producer | system | NULL. Only a producer-entered premium decides the rated content track (Frank, 24 Sep 2026). NULL means unknown and must not be read as either.';
COMMENT ON COLUMN "Lead"."ratedBy" IS
  'Who entered it, where the activity history records a name. Absent on older rows whose author was never captured.';
