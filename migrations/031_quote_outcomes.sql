-- 031: quote outcomes — band provenance, quote capture, loss capture
--      (directive Sec. 10.6 and Sec. 10.9, 21 Sep 2026)
--
-- WHAT THIS DOES *NOT* ADD, AND WHY
-- Most of Sec. 10.9 is already here and works. bandHit / bandVariancePct /
-- bandMeasuredAt are computed server-side from publishedBand* against boundPremium, and
-- are on the SERVER_OWNED list so a producer cannot type an accuracy verdict no bind
-- produced. indicativeBand*, publishedBand*, competitorCarrier, competitorPremium,
-- lostReason, lostStage, quotedAt and revisitFlag/revisitDate all exist.
--
-- Adding Frank's field names alongside them — band_low next to indicativeBandLow,
-- re_engage_at next to revisitDate — would give this table two columns for one fact, and
-- every report would then have to pick one and be quietly wrong for the rows that used
-- the other. So only the genuinely missing pieces are added, and the report layer maps
-- them onto the directive's vocabulary.
--
-- THE THREE REAL GAPS
--
-- 1. Rating provenance. A band is produced by a person in a carrier's portal, at a time,
--    at ~50/day. Nothing recorded WHICH carrier or WHO rated it, so "accuracy is strong
--    for condos and weak for single-family" — the finding Sec. 10.9 exists to produce —
--    could not be cut by the thing most likely to explain it.
--
-- 2. Accuracy is measured only at BIND. Sec. 10.9 lists quoted_premium and quoted_carrier
--    because a quote happens weeks before a bind and most leads never bind at all.
--    Measuring only at bind means the sample is the handful that closed, which is both
--    tiny and selected — the leads where the band was WRONG are exactly the ones that
--    walked away, and they would never enter the average.
--
-- 3. The loss conversation. competitorCarrier and competitorPremium exist and are empty
--    on every row. What was missing is the rest of the record that makes them useful:
--    when it was lost, what we had quoted, and the free text.

ALTER TABLE "Lead"
  -- ── 1. Rating provenance (Sec. 10.9 "At rating") ──────────────────────────
  -- Which carrier's portal produced the band, who ran it, when. bandLow/High themselves
  -- are indicativeBandLow/High, which already exist.
  ADD COLUMN IF NOT EXISTS "bandCarrier"      TEXT,
  ADD COLUMN IF NOT EXISTS "bandRatedAt"      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "bandRatedBy"      TEXT,

  -- ── 2. The quote itself (Sec. 10.9 "At quote") ────────────────────────────
  -- quotedAt already exists. posQuotePremium is the POS system's figure and is compared
  -- against expectedPremium, our internal estimate — a different question from "what did
  -- we actually quote this person". Kept separate rather than overloaded.
  ADD COLUMN IF NOT EXISTS "quotedPremium"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "quotedCarrier"    TEXT,
  -- Measured at quote time, against the band the homeowner actually read. Distinct from
  -- bandHit, which is measured at bind and answers whether the band held to the end.
  ADD COLUMN IF NOT EXISTS "bandHitAtQuote"   BOOLEAN,
  ADD COLUMN IF NOT EXISTS "bandQuoteMeasuredAt" TIMESTAMP,

  -- ── 3. The loss (Sec. 10.6) ───────────────────────────────────────────────
  -- lostReason, lostStage, competitorCarrier and competitorPremium already exist.
  ADD COLUMN IF NOT EXISTS "lostAt"           TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lostNotes"        TEXT;

-- premium_gap is NOT stored. It is quotedPremium − competitorPremium, in dollars and
-- percent, and a stored copy would disagree with its inputs the moment either is
-- corrected. Derived in pricing.service, where the two reports that need it both read it.

-- The reports cut by carrier and by outcome, over the whole book.
CREATE INDEX IF NOT EXISTS "Lead_bandRated_idx" ON "Lead" ("bandRatedAt") WHERE "bandRatedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Lead_lostAt_idx"    ON "Lead" ("lostAt")      WHERE "lostAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Lead_quoted_idx"    ON "Lead" ("quotedAt")    WHERE "quotedAt" IS NOT NULL;
