-- ZeroBounce verification results (Frank, 25 Sep 2026)
--
-- "Abdullah add 'verified emails' column to QC cohort ledger inserted right next to
--  'mailable' to reflect Zero Bounce results... the non verified results need to speak
--  directly back to the cards."
--
-- ── Why a table and not a column on Lead ────────────────────────────────────
-- Verification is a fact about an ADDRESS, not about an account. A lead can carry several
-- addresses; the insured's may verify while the co-insured's does not, and a re-trace can
-- replace either. A column on Lead would have to pick one address to describe and would
-- silently go on describing it after the address changed.
--
-- Keyed on the address itself, the same way the surname review is, so a changed address has
-- no verification rather than the previous address's verification.
--
-- ── Why the raw status is kept ──────────────────────────────────────────────
-- ZeroBounce returns more than valid/invalid: catch-all, unknown, spamtrap, abuse,
-- do_not_mail, each with a sub-status. Collapsing that to a boolean at import would throw
-- away the distinction between "this mailbox does not exist" and "this domain accepts
-- everything so we cannot tell" — and those two call for different decisions. The boolean
-- the ledger counts is derived from the status, not stored instead of it.

CREATE TABLE IF NOT EXISTS "EmailVerification" (
  "id"          TEXT PRIMARY KEY,

  -- Stored lower-cased. This is the key: the verdict belongs to this address and no other.
  "email"       TEXT NOT NULL,

  -- Whose address it was when it was checked. Copied rather than joined so a re-trace that
  -- moves an address between people cannot rewrite the history of a run that was reported.
  "leadId"      TEXT,
  "propertyId"  TEXT,
  "cohort"      TEXT,
  "personRole"  TEXT,

  -- ZeroBounce's own words: valid | invalid | catch-all | unknown | spamtrap | abuse |
  -- do_not_mail. Kept verbatim; nothing here interprets it on the way in.
  "status"      TEXT NOT NULL,
  "subStatus"   TEXT,

  -- Whether it counts as reachable for the ledger. Derived from status on import, stored so
  -- every reader agrees — a rule re-applied in four places is a rule that differs in four
  -- places.
  "deliverable" BOOLEAN NOT NULL DEFAULT FALSE,

  -- Which run this came from, so two imports of the same address are distinguishable and a
  -- re-verification can be told from the original.
  "source"      TEXT NOT NULL DEFAULT 'zerobounce',
  "batchLabel"  TEXT,
  "verifiedAt"  TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Anything else the file carried, so nothing is lost on import.
  "raw"         JSONB,

  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One current verdict per address. A re-verification updates it rather than adding a second,
-- so "is this address deliverable" always has exactly one answer.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailVerification_email_key"
  ON "EmailVerification" (lower("email"));

CREATE INDEX IF NOT EXISTS "EmailVerification_lead_idx"   ON "EmailVerification" ("leadId");
CREATE INDEX IF NOT EXISTS "EmailVerification_cohort_idx" ON "EmailVerification" ("cohort");
-- The list Frank wants to call first: rated, no verified email.
CREATE INDEX IF NOT EXISTS "EmailVerification_bad_idx"
  ON "EmailVerification" ("cohort") WHERE NOT "deliverable";

COMMENT ON TABLE "EmailVerification" IS
  'One row per email address checked by a verifier. Keyed on the address, because that is what a verdict describes (Frank, 25 Sep 2026).';
COMMENT ON COLUMN "EmailVerification"."deliverable" IS
  'Derived from status at import and stored, so the ledger, the QC report and the send list cannot apply the rule differently.';
