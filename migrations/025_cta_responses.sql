-- Playbook §05: engagement instrumentation — the six one-click CTAs.
--
-- "A typed reply is a high-friction action and it is the wrong bar for a homeowner reading
-- personal email on a phone at nine at night. Today a non-reply is unattributable — we
-- cannot separate 'never saw it' from 'saw it, not interested' from 'interested but did not
-- have three minutes.'"
--
-- Two of the six buttons return measurements available no other way: roof age, which gates
-- the entire Grade B pool, and person-match accuracy, which nothing else in this pipeline
-- can measure at all.

CREATE TABLE IF NOT EXISTS "CtaResponse" (
  "id"          TEXT PRIMARY KEY,
  "leadId"      TEXT NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  -- quote | savings | defer | roof | no_thanks | not_mine
  "cta"         TEXT NOT NULL,

  -- Every arrival is recorded; only a CONFIRMED one is acted on.
  --
  -- Email security scanners and clients prefetch links. A single GET that suppressed a
  -- homeowner would fire on a scanner that never had a human behind it, and for "No thanks"
  -- and "This is not my property" that mistake is unrecoverable: we would permanently stop
  -- mailing someone who never touched the email. The playbook already distrusts opens for
  -- exactly that reason, and a link in the same email deserves the same suspicion.
  --
  -- The landing page confirms from the browser after render, which a scanner does not do.
  "confirmed"   BOOLEAN NOT NULL DEFAULT FALSE,
  "clickedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "confirmedAt" TIMESTAMP,

  -- Which send this came from, so engagement can be attributed to a step and a cohort.
  "campaignId"  TEXT,
  "emailStep"   INTEGER,
  "cohort"      TEXT,

  -- Per-CTA answers: the renewal date from "not now", the roof year from "roof replaced".
  "payload"     JSONB,

  -- Enough to spot abuse or a scanner storm; deliberately NOT the raw IP.
  "userAgent"   TEXT,
  "ipHash"      TEXT,

  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "CtaResponse_leadId_idx"  ON "CtaResponse" ("leadId");
CREATE INDEX IF NOT EXISTS "CtaResponse_cta_idx"     ON "CtaResponse" ("cta", "confirmed");
CREATE INDEX IF NOT EXISTS "CtaResponse_cohort_idx"  ON "CtaResponse" ("cohort");

-- ── What two of the buttons write back onto the lead ────────────────────────

-- "My roof was replaced in the last 10 years". A claim, not a measurement: we are told it
-- is recent, not which year. Recorded as a claim rather than written into roofYear, because
-- inventing a year to satisfy a grading rule is how a guess becomes a fact nobody can
-- trace. "PROMOTE TO VERIFY · never downgrades".
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "roofRecentClaim"   BOOLEAN;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "roofRecentClaimAt" TIMESTAMP;

-- "This is not my property" — the only direct measurement of person-match accuracy that
-- exists. Also suppresses: someone who says the property is not theirs must not be mailed
-- about it again.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "personMatchBad"   BOOLEAN;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "personMatchBadAt" TIMESTAMP;

COMMENT ON TABLE "CtaResponse" IS
  'One row per CTA link arrival (playbook §05). Only confirmed rows are acted on — unconfirmed ones are usually link prefetch by a scanner.';
