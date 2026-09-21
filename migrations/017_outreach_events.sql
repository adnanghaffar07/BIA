-- Frank Sep-2026, pre-launch checklist T1.1 — campaign state per lead + an outreach
-- event log. This is the local half of the campaign-tool integration.
--
-- The campaign platform is the system of record: campaigns, sequences, schedules and
-- sender mailboxes live there and are addressed only by the string IDs it assigns.
-- There is deliberately NO local "Campaign" table. These rows exist purely to bolt
-- CRM concerns onto those external IDs — which of our leads a vendor lead came from,
-- and what happened to it.
--
-- OutreachEvent is one row per (lead, person, send). The webhook matches an inbound
-- reply/open/bounce back to a row on ("vendorCampaignId", "recipientEmail") and writes
-- the outcome onto it, then mirrors the headline facts onto the Lead so an activity
-- feed reads the same whether the message went out through the campaign platform or
-- any other channel.
--
-- `indicative_sent` on Lead.status is NOT extended to carry step state — it stays
-- where it is, and "currentEmailStep" is the source of truth for sequence position.
CREATE TABLE IF NOT EXISTS "OutreachEvent" (
  "id"               TEXT PRIMARY KEY,
  "leadId"           TEXT NOT NULL,
  -- Denormalised so reporting can join without a second lookup; Lead.propertyId is
  -- the id every other surface in this CRM addresses a lead by.
  "propertyId"       TEXT,
  -- Which person at the household this send went to. A reply from either one has to
  -- halt sends to the other, so the role has to be on the row.
  "personRole"       TEXT NOT NULL DEFAULT 'insured',
  "recipientEmail"   TEXT NOT NULL,
  -- Vendor slug. One more "channel" alongside any other send path, so a future
  -- direct-send route writes the same table.
  "channel"          TEXT NOT NULL DEFAULT 'campaign',
  "vendorLeadId"     TEXT,
  "vendorCampaignId" TEXT,
  "emailStep"        INTEGER,

  "sentAt"           TIMESTAMP DEFAULT NOW(),
  "deliveredAt"      TIMESTAMP,
  "openedAt"         TIMESTAMP,
  "openCount"        INTEGER NOT NULL DEFAULT 0,
  "clickedAt"        TIMESTAMP,
  "ctaAction"        TEXT,
  "repliedAt"        TIMESTAMP,
  "replyExcerpt"     TEXT,
  "bouncedAt"        TIMESTAMP,
  "bounceType"       TEXT,
  "bounceReason"     TEXT,
  "unsubscribedAt"   TIMESTAMP,
  "complainedAt"     TIMESTAMP,

  "createdAt"        TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The webhook's lookup path: campaign + recipient, most recent first.
CREATE INDEX IF NOT EXISTS "OutreachEvent_campaign_recipient_idx"
  ON "OutreachEvent" ("vendorCampaignId", "recipientEmail");
-- A webhook payload without a campaign id still has to find its row.
CREATE INDEX IF NOT EXISTS "OutreachEvent_recipient_idx" ON "OutreachEvent" ("recipientEmail");
CREATE INDEX IF NOT EXISTS "OutreachEvent_leadId_idx" ON "OutreachEvent" ("leadId");
-- Double-send prevention: one row per lead, person and step within a campaign.
CREATE UNIQUE INDEX IF NOT EXISTS "OutreachEvent_no_double_send_idx"
  ON "OutreachEvent" ("vendorCampaignId", "leadId", "personRole", "emailStep")
  WHERE "emailStep" IS NOT NULL;

-- ── Campaign state mirrored onto the Lead ────────────────────────────────────
-- queued | active | engaged | suppressed | completed | holdout
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignStatus"         TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignCohort"         TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "currentEmailStep"       INTEGER;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignLastSentAt"     TIMESTAMP;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignRepliedAt"      TIMESTAMP;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignBouncedAt"      TIMESTAMP;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "campaignUnsubscribedAt" TIMESTAMP;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "hardBounced"            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "suppressedReason"       TEXT;
-- Excluded from every send query, still counted in reporting.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "holdoutFlag"            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "vendorCampaignId"       TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "vendorLeadId"           TEXT;

CREATE INDEX IF NOT EXISTS "Lead_campaignStatus_idx" ON "Lead" ("campaignStatus") WHERE "campaignStatus" IS NOT NULL;
