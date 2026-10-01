-- The three calls to action, edited in the CRM instead of compiled into it.
--
-- Abdullah, 1 Oct 2026: a sub-tab under Campaigns like Email variables, three CTAs, one
-- value each, picked up automatically by every lead so every campaign says the same thing.
--
-- ── Why they were wrong where they were ────────────────────────────────────
-- The wording lived in CTA_BY_STEP, a constant in campaignSegment.service. Changing a
-- sentence a homeowner reads meant a code change and a deploy, which is the wrong people
-- and the wrong timescale: Zoya writes the copy, and she cannot edit a TypeScript file.
-- The same reasoning already moved agency_website and the merge variables out of the code.
--
-- ── One value per step, not two ────────────────────────────────────────────
-- The constant held TWO arms per step and dealt people between them — the §3 A/B test.
-- Three rows here means one wording per step and no arm split, which is what was asked for.
-- The constant stays in the code as the fallback for an empty row, so a blank CTA sends the
-- old wording rather than nothing; the subject-line A/B test is untouched.
--
-- step is the primary key and there are exactly three. A CTA is tied to its email — the
-- first ask, the follow-up, the last — so it is not a free-form list the way the merge
-- variables are, and a fourth row would describe an email that does not exist.
CREATE TABLE IF NOT EXISTS "CampaignCta" (
  "step"      integer PRIMARY KEY CHECK ("step" BETWEEN 1 AND 3),
  -- A short name for the ask, shown in the picker and in the version label.
  "label"     text NOT NULL,
  -- What the homeowner reads. May contain merge tokens such as {{ agency_website }}.
  "wording"   text NOT NULL DEFAULT '',
  "updatedAt" timestamp without time zone NOT NULL DEFAULT NOW(),
  "updatedBy" text
);

-- Seeded from the wording that was in the code, so nothing changes the moment this lands
-- and the screen opens on the real copy rather than on three empty boxes.
INSERT INTO "CampaignCta" ("step", "label", "wording", "updatedBy")
VALUES
  (1, 'Ask — email 1', 'Reply "yes" and I''ll get started.', 'migration'),
  (2, 'Ask — email 2', 'Reply and I''ll have your number back to you tomorrow.', 'migration'),
  (3, 'Ask — email 3', 'Pick a time and I''ll call you: {{ agency_website }}/meet', 'migration')
ON CONFLICT ("step") DO NOTHING;
