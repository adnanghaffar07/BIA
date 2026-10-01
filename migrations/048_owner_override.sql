-- Owner and co-insured corrections taken from the municipal tax roll (WIIP).
--
-- Frank, 1 Oct 2026: "WIIP is the source of truth for owner and co-insured names.
-- Skip tracing runs only on WIIP-verified data." And: "Never delete the REAPI value.
-- Keep it on the card with the date and reason for the change."
--
-- So the card holds the current best name and this table holds what it replaced. The
-- alternative — a pair of "original" columns on Lead — records only the most recent
-- change and cannot answer "what did we send the vendor in September", which is the
-- question that started this (a trace was run on a reversed name and nobody could show
-- when it had been reversed).
--
-- A row is written for every PROPOSAL, applied or not. Frank's auto-apply rule is
-- narrow on purpose — exact address match, overlapping names — and the rows it refuses
-- are the ones he wants to see. Logging only what was applied would throw away exactly
-- the cases needing a human.
CREATE TABLE IF NOT EXISTS "OwnerOverride" (
  "id"          text PRIMARY KEY,
  "leadId"      text NOT NULL,
  -- 'insured' | 'coInsured' — which person on the card this concerns.
  "role"        text NOT NULL,
  "fromFirst"   text,
  "fromLast"    text,
  "toFirst"     text,
  "toLast"      text,
  -- The whole tax-roll string, kept verbatim. The parse is a reading of it, and a
  -- reading we may later improve; the source line is what we can always go back to.
  "rollName"    text,
  -- 'applied' | 'flagged' | 'reverted'
  "state"       text NOT NULL,
  -- Why it was applied or refused, in words a person can act on.
  "reason"      text,
  -- 'match' | 'partial' | 'mismatch' | 'unknown' from compareOwnerNames.
  "nameMatch"   text,
  "decidedBy"   text,
  "decidedAt"   timestamp without time zone NOT NULL DEFAULT NOW(),
  "createdAt"   timestamp without time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "OwnerOverride_leadId_idx" ON "OwnerOverride" ("leadId");
-- The review queue reads this: everything still waiting on a decision, newest first.
CREATE INDEX IF NOT EXISTS "OwnerOverride_state_idx" ON "OwnerOverride" ("state", "decidedAt" DESC);
