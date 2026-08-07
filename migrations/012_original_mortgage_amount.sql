-- Frank Aug-2026: the ORIGINAL mortgage amount at closing (not the current open
-- balance), needed to analyze equity. Not in the bulk REAPI pull — it comes from the
-- granular PropertyDetail call (currentMortgages[0].amount). Stored so it can be
-- surfaced alongside Open Mortgage / Lender in the Financials panel.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "originalMortgageAmount" NUMERIC;
