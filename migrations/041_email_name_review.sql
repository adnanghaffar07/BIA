-- The surname review list (Frank's directive, 24 Sep 2026 · second email §7, item 5)
--
-- "What I need before we send: a surname match between every skip-trace-recovered address and
--  the insured or co-insured. Failures go to a review list, not into a send."
--
-- ── The account that prompted it ────────────────────────────────────────────
-- Insured Claudia Garcia, co-insured Cesar Garcia, and the only address on the record is
-- dburnette19@gmail.com — recovered by a skip trace on 18 September that reported one email
-- found. It matches neither name.
--
-- Frank: "If that account sends, we email a stranger the estimated premium and property
-- details for someone else's home. That is a privacy disclosure and a near-certain spam
-- complaint, landing on a domain with no sending history to absorb it."
--
-- And the point that rules out the obvious alternative: "Email verification will not catch
-- this. It confirms a mailbox exists, not that it belongs to the person."
--
-- ── Why a table and not columns on Lead ─────────────────────────────────────
-- The verdict is about an ADDRESS, not an account. A lead has an insured address and a
-- co-insured address, either can change when a trace re-runs, and a verdict attached to the
-- lead would quietly go on applying to an address it was never computed for. Keying on the
-- address itself means a changed address has no verdict rather than the wrong one.
--
-- It is also literally what Frank asked for: a review list. A queue somebody works through
-- and clears, with the decision recorded against the person who made it.
--
-- ── Held by default ─────────────────────────────────────────────────────────
-- A row exists only for an address that did NOT match. Its presence, undecided, is what
-- keeps the address out of a send; approving it is a deliberate act by a named person. The
-- failure mode this guards against is silent release, so the default is hold.

CREATE TABLE IF NOT EXISTS "EmailNameReview" (
  "id"          TEXT PRIMARY KEY,
  "leadId"      TEXT NOT NULL,
  "propertyId"  TEXT,
  "cohort"      TEXT,

  -- 'insured' | 'coInsured' — which person this address was going to be used for.
  "personRole"  TEXT NOT NULL,

  -- Stored lower-cased. The verdict belongs to this exact address and nothing else.
  "email"       TEXT NOT NULL,

  -- 'review' | 'mismatch'. A match never gets a row — the list is the exceptions.
  "verdict"     TEXT NOT NULL,
  "checkedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),

  -- NULL = still held. 'approved' releases it to send; 'rejected' keeps it out for good.
  "decision"    TEXT,
  "decidedBy"   TEXT,
  "decidedAt"   TIMESTAMP,
  "note"        TEXT,

  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row per address per person. Re-running the check must not duplicate the queue, and a
-- decision already made must survive the next run.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailNameReview_addr_key"
  ON "EmailNameReview" ("leadId", "personRole", "email");

-- The send-time question: is this address held?
CREATE INDEX IF NOT EXISTS "EmailNameReview_open_idx"
  ON "EmailNameReview" ("email") WHERE "decision" IS NULL;
CREATE INDEX IF NOT EXISTS "EmailNameReview_cohort_idx" ON "EmailNameReview" ("cohort");

COMMENT ON TABLE "EmailNameReview" IS
  'Skip-trace-recovered addresses that do not match the insured or co-insured surname. An undecided row holds the address out of every send (Frank, 24 Sep 2026, second email §7).';
COMMENT ON COLUMN "EmailNameReview"."decision" IS
  'NULL = held. approved = a person confirmed it belongs to the insured and it may send. rejected = it does not, keep it out.';
