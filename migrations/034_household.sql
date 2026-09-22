-- 034: the household becomes a record instead of a calculation.
--
-- Directive Sec. 11.5 question 2. Frank was told early October; this is that work.
--
-- ── Why a stored row at all ─────────────────────────────────────────────────
-- Membership is computed on demand today: a union-find over leads sharing a normalised
-- property address OR an email address. That works, and it has one property that makes it
-- unsafe to keep — the key is a FUNCTION, so changing the function silently rewrites
-- history. It already happened once: normaliseStreet stripped unit numbers, five condo
-- units at 100 John T O Leary Blvd collapsed into a single household, and four real
-- owners were dropped from the send list. Nothing errored. With the answer written down,
-- changing how it is derived becomes a migration somebody can see and reverse.
--
-- ── Why a surrogate id, and not the address ─────────────────────────────────
-- There are currently TWO key schemes in household.service.ts and they disagree:
-- groupHouseholds() returns `hh:<lowest lead id>` while householdKeyOf() returns
-- `hh:<street>|<zip>`. The second is what a suppression records. So a household the
-- union-find joins across two properties — by a shared email — has members whose
-- suppression keys differ, and a household-wide stop on one misses the other. On today's
-- data that is exactly one household: 78 Orchard St, Freehold and 62 Harvest Ridge Rd,
-- Howell, held together by one address.
--
-- Neither scheme can be the identity. An address cannot name a household that spans two
-- properties, and a lead id is not stable — it changes the moment a lead with a lower id
-- joins the group, which would silently re-point every suppression made under the old one.
-- So identity is a surrogate, and both the address key and the membership become
-- attributes of the row.
--
-- This is safe to do NOW precisely because "Suppression" holds no household rows yet.
-- After the first household suppression exists, this same change would need those rows
-- migrated with it.
--
-- ── What this migration does NOT do ─────────────────────────────────────────
-- It does not introduce a person. Insured and co-insured are both leads, and this makes
-- the household explicit without making people explicit. A person who moves between
-- properties is a third entity and is deliberately out of scope — nothing in the directive
-- needs it, and the property data does not support it well.

CREATE TABLE IF NOT EXISTS "Household" (
  "id"                TEXT PRIMARY KEY,
  -- The normalised property this household sits on, when it sits on exactly one.
  -- NULL for a household spanning several: an address cannot name it, which is the whole
  -- reason identity is separate from address.
  "addressKey"        TEXT,
  -- How many properties the group covers; 1 for almost all of them. Stored rather than
  -- counted so the odd cases can be listed without a join.
  "addressCount"      INTEGER NOT NULL DEFAULT 1,
  "leadCount"         INTEGER NOT NULL DEFAULT 0,

  -- Sec. 7.1 / Sec. 12: once engagement confirms an address, only that address is used —
  -- for the whole household, insured and co-insured alike. That fact belongs to the
  -- household, not to whichever lead happened to receive the reply.
  "confirmedEmail"    TEXT,
  "confirmedAt"       TIMESTAMP,
  "confirmedVia"      TEXT,

  -- Provenance, so a household that looks wrong can be traced to the run that built it.
  "derivedAt"         TIMESTAMP NOT NULL DEFAULT NOW(),
  "derivedBy"         TEXT,
  "createdAt"         TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Nullable and NOT a foreign key constraint, deliberately.
--
-- A lead with no household yet must be possible: the backfill runs over 9,937 rows and
-- new leads arrive from a pull before anything groups them. A hard constraint would make
-- an unmaterialised lead an insert failure rather than a row the nightly check reports.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "householdId" TEXT;

-- The lookup every send-time check makes.
CREATE INDEX IF NOT EXISTS "Lead_householdId_idx"
    ON "Lead" ("householdId")
 WHERE "householdId" IS NOT NULL;

-- Finding a household by its property, which is how a re-derivation matches an existing
-- row instead of creating a duplicate.
CREATE INDEX IF NOT EXISTS "Household_addressKey_idx"
    ON "Household" ("addressKey")
 WHERE "addressKey" IS NOT NULL;

-- The households worth looking at by eye: the ones covering more than one property.
CREATE INDEX IF NOT EXISTS "Household_multiAddress_idx"
    ON "Household" ("addressCount")
 WHERE "addressCount" > 1;
