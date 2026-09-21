-- 028: suppression and confirmed address, held in the CRM (Frank, 21 Sep 2026)
--
-- Directive S2: "Suppression persisted in the CRM, not only the email tool. Currently
-- captured and never stored." And from the 21 Sep email: "household suppression rule
-- confirmed · dedup at both levels evidenced".
--
-- WHY THIS CANNOT LIVE IN THE EMAIL TOOL
-- The campaign tool suppresses by email address, inside one workspace, for as long as that
-- workspace exists. Three things break on that alone:
--
--   · It has no idea that two addresses are one household. An insured who says "stop"
--     suppresses their own address while the co-insured keeps receiving the sequence —
--     from the same household's point of view we did not stop.
--   · It is scoped to the tool. Ruben's outbound calls and next year's renewal cycle
--     never see it, so a household that opted out of email gets phoned anyway.
--   · It is not evidence. Sec. 11.2 requires any card to be reconstructable on any past
--     date; an opt-out that exists only as a vendor setting cannot be reconstructed.
--
-- WHY A TABLE RATHER THAN FLAGS ON "Lead"
-- A suppression is an EVENT with a cause and a time, and one lead can accumulate several
-- for different addresses and different reasons. A boolean column would answer "is this
-- lead suppressed" and lose who asked, when, on which address, and whether it applies to
-- the whole household or to one mailbox that hard-bounced. Those distinctions are the
-- ones that decide whether the NEXT address on the card may be used.
--
-- Append-only by intent: a suppression is never deleted, it is released with a reason.

CREATE TABLE IF NOT EXISTS "Suppression" (
  "id"            TEXT PRIMARY KEY,

  -- 'address'   — this one mailbox only. The next valid address on the card may be used.
  --               Hard bounces are this: the person did not refuse us, the mailbox is dead.
  -- 'household' — everyone on the card, every channel, indefinitely. Opt-outs, complaints
  --               and DNC are this. Nothing about that household may be contacted again.
  "scope"         TEXT NOT NULL CHECK ("scope" IN ('address', 'household')),

  -- Lower-cased. Set for scope='address'; also set for scope='household' when the
  -- suppression arrived through a specific address, so the record says who asked.
  "email"         TEXT,

  -- The household this applies to. Derived by household.service from the property
  -- address, so it survives a lead being re-pulled under a new id.
  "householdKey"  TEXT,

  -- The lead it came from. Traceability only — NEVER the thing matched on, because a
  -- household can span more than one lead row and a suppression must outlive any of them.
  "leadId"        TEXT,

  -- 'unsubscribe' | 'complaint' | 'hard_bounce' | 'not_interested' | 'dnc' | 'manual'
  "reason"        TEXT NOT NULL,

  -- 'campaign_tool' | 'crm' | 'producer' | 'import'
  -- Never the vendor's brand name: it is stored, exported and read by people, and the
  -- platform is replaceable. See the header of lib/integrations/leadCampaign.ts.
  "source"        TEXT,

  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdBy"     TEXT,
  "note"          TEXT,

  -- Released rather than deleted: a suppression that vanishes cannot be audited, and
  -- "was this household ever opted out?" is a question with legal weight.
  "releasedAt"    TIMESTAMP,
  "releasedBy"    TEXT,
  "releaseNote"   TEXT
);

-- The send-time check runs per recipient on every send (Sec. 7.1: "checked at send time,
-- not only when the batch is built"), so both lookups have to be cheap.
CREATE INDEX IF NOT EXISTS "Suppression_email_active_idx"
  ON "Suppression" (LOWER("email")) WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Suppression_household_active_idx"
  ON "Suppression" ("householdKey") WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Suppression_lead_idx" ON "Suppression" ("leadId");

-- ── Confirmed address (Sec. 7.1, Sec. 12) ───────────────────────────────────
-- "Once an address is confirmed by engagement, only that address receives email —
-- insured and co-insured alike." Engagement promotes a contact point permanently, this
-- cycle and every future one (Sec. 11.2), so it belongs on the lead and not in a campaign.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "confirmedEmail"   TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt"      TIMESTAMP,
  -- 'reply' | 'click' | 'meeting'. Never 'open' — Apple and Gmail auto-open, so an open
  -- confirms nothing and must never switch an address.
  ADD COLUMN IF NOT EXISTS "confirmedVia"     TEXT,
  -- Which person on the card engaged, so the co-insured taking over is visible.
  ADD COLUMN IF NOT EXISTS "confirmedRole"    TEXT;

CREATE INDEX IF NOT EXISTS "Lead_confirmedEmail_idx"
  ON "Lead" (LOWER("confirmedEmail")) WHERE "confirmedEmail" IS NOT NULL;
