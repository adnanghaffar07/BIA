-- Household-level stop: one engagement ends outreach to the whole card.
--
-- A card now yields ~2.19 recipients (every address belonging to the named insured),
-- so per-recipient suppression is no longer enough. A reply from one address used to
-- leave the sequence running to the others — the household gets chased after it has
-- already answered, which reads as incompetence and invites a complaint.
--
-- The stop has to be recorded, not just performed. The sending platform has NO way to
-- pause or stop an individual lead: /leads/{id}/pause and /leads/stop do not exist,
-- PATCH /leads/{id} accepts a `status` and silently discards it (verified — it stayed
-- 1 through every value tried), and update-interest-status only queues a background job
-- against a different field. Removing the lead from the campaign is the only mechanism
-- that provably halts sends, and it destroys that lead's record on the vendor side.
-- These columns are therefore where the history lives afterwards.

ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "stoppedAt"     TIMESTAMP;
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "stoppedReason" TEXT;
-- Which engagement caused it, so a stop can always be traced to its trigger rather
-- than looking like the campaign silently dropped someone.
ALTER TABLE "OutreachEvent" ADD COLUMN IF NOT EXISTS "stoppedBy"     TEXT;

-- The address that answered. Once someone on the household replies, every later
-- conversation goes to them — including the next renewal cycle, which is the point of
-- storing it on the Lead rather than inferring it from events each time.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "primaryContactEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "primaryContactRole"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "primaryContactAt"    TIMESTAMP;

-- The stop routine looks up every sibling recipient of one card, on every engagement.
CREATE INDEX IF NOT EXISTS "OutreachEvent_leadId_idx" ON "OutreachEvent" ("leadId");
