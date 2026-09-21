-- 029: reply classification on the outreach event (directive Sec. 7.6, 21 Sep 2026)
--
-- Frank: "Without it the engagement number in your end-of-day report cannot be computed."
-- Eight categories, each with an action attached — see src/lib/replyClasses.ts, which is
-- the single place the list and its consequences live.
--
-- WHY ON "OutreachEvent" AND NOT ON "Lead"
-- A classification describes one REPLY, not a person. The same household can answer twice
-- in one cadence — a question at E1 and "not interested" at E2 — and the pair is the
-- story. A column on the lead would keep only the last one and quietly lose the first.
--
-- The lead-level consequences (suppression, re-engagement date, confirmed address) are
-- written where they belong by replies.service, so this column stays a record of what was
-- said rather than a switch anything reads to decide behaviour.

ALTER TABLE "OutreachEvent"
  ADD COLUMN IF NOT EXISTS "replyClass"   TEXT,
  ADD COLUMN IF NOT EXISTS "replyClassAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "replyClassBy" TEXT,
  -- The vendor's own id for the inbound message. It is what a reply must quote
  -- (reply_to_uuid) to land in the same thread; without it a reply can only be composed
  -- fresh, which reaches the prospect as a disconnected email from a stranger.
  ADD COLUMN IF NOT EXISTS "vendorMessageId" TEXT;

CREATE INDEX IF NOT EXISTS "OutreachEvent_replyClass_idx"
  ON "OutreachEvent" ("replyClass") WHERE "replyClass" IS NOT NULL;
