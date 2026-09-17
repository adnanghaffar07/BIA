-- Playbook §08: protective metrics — daily, automatic, system-enforced.
--
-- "These four can destroy the sending infrastructure in a single day. They are monitored
-- daily and enforced by the system, not by anyone's judgment. A breach pauses sending
-- automatically; restarting requires Frank's sign-off."
--
--   metric              target      pause at
--   bounce rate         under 2%    5%
--   spam complaints     under 0.1%  0.3%      (Gmail's enforcement threshold)
--   inbox placement     80%+        under 75%
--   unsubscribe rate    under 0.5%  1%
--
-- Three of the four are computable from OutreachEvent. Inbox placement is not: it requires
-- a seed-list test with a tool nobody has named yet (register A27), so it is entered by
-- hand here rather than silently reported as healthy — a metric with no reading must never
-- look like a passing one.

-- ── Pause events ────────────────────────────────────────────────────────────
-- A pause is a fact about the campaign, not a UI state, and it has to outlive the vendor:
-- the sending platform knows a campaign is paused but not WHY, and "restarting requires
-- Frank's sign-off" needs somewhere to record that the sign-off happened.
CREATE TABLE IF NOT EXISTS "CampaignPause" (
  "id"            TEXT PRIMARY KEY,
  "campaignId"    TEXT NOT NULL,
  -- 'bounce_rate' | 'complaint_rate' | 'unsubscribe_rate' | 'inbox_placement'
  "metric"        TEXT NOT NULL,
  "value"         DOUBLE PRECISION,
  "threshold"     DOUBLE PRECISION,
  -- The denominator the rate was computed over. A rate without its n cannot be judged
  -- afterwards, and §07 is explicit that some of these are unreadable at low volume.
  "sampleSize"    INTEGER,
  "detail"        TEXT,
  "pausedAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Whether the vendor actually accepted the pause. A breach we detected but could not
  -- enforce is the most dangerous state there is, so it is recorded distinctly.
  "vendorPaused"  BOOLEAN NOT NULL DEFAULT FALSE,
  "vendorError"   TEXT,
  -- Sign-off. NULL means still paused.
  "releasedAt"    TIMESTAMP,
  "releasedBy"    TEXT,
  "releaseNote"   TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "CampaignPause_campaign_idx" ON "CampaignPause" ("campaignId", "releasedAt");

-- ── Inbox placement readings ────────────────────────────────────────────────
-- "Report placement per domain and per mailbox. An aggregate number hides which mailbox
-- is burning, which is exactly what you need to know first."
CREATE TABLE IF NOT EXISTS "InboxPlacement" (
  "id"          TEXT PRIMARY KEY,
  "measuredAt"  TIMESTAMP NOT NULL,
  -- Which seed tool produced this. Recorded because no tool has been agreed yet and a
  -- reading is only as trustworthy as its source.
  "tool"        TEXT,
  -- NULL = the run's overall figure; set = a per-domain or per-mailbox breakdown.
  "domain"      TEXT,
  "mailbox"     TEXT,
  "primaryPct"  DOUBLE PRECISION NOT NULL,
  "promotionsPct" DOUBLE PRECISION,
  "spamPct"     DOUBLE PRECISION,
  "note"        TEXT,
  "enteredBy"   TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "InboxPlacement_measuredAt_idx" ON "InboxPlacement" ("measuredAt" DESC);

COMMENT ON TABLE "CampaignPause" IS
  'Automatic sending pauses from the §08 protective metrics. releasedAt NULL = still paused; release requires sign-off.';
COMMENT ON TABLE "InboxPlacement" IS
  'Seed-list inbox placement readings, entered by hand until a seed tool is agreed (register A27).';
