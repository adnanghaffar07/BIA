-- The subject lines, edited in the CRM instead of compiled into it.
--
-- Abdullah, 2 Oct 2026, after the CTAs moved: the subjects should work the same way.
--
-- ── Why this is 25 rows and the CTAs were 3 ────────────────────────────────
-- A CTA is one ask and it reads the same to anybody. A subject line is not: §5 varies it by
-- who is being written to and when.
--
--   segment   a RATED account is offered a number; an UNRATED one cannot be, so it gets
--             "nobody's looked at this since you closed" instead of a price it has no
--             figure for. Grade B is a different offer again — the roof.
--   cohort    §1.2: "C1–C5 lead with the number, C6 and C7 introduce first." A lead six
--             weeks from renewal should not read C1's "last stretch".
--   step      the first approach, the follow-up, the last note.
--   variant   the A/B test, which is the one still running.
--
-- Collapsing that to three would send priced copy to accounts with no price. So the rows
-- stay, and what changes is only that they are editable without a deploy.
--
-- ── Why cohorts is a list rather than a range ──────────────────────────────
-- The groupings are not regular: rated email 1 variant A covers C1–C5 while variant B
-- splits C1–C3 from C4–C5. A from/to pair would imply an order the copy does not have, and
-- the first irregular grouping would be stored as something it is not.
CREATE TABLE IF NOT EXISTS "CampaignSubject" (
  "id"        text PRIMARY KEY,
  -- 'rated' | 'unrated' | 'grade_b'
  "segment"   text NOT NULL,
  "step"      integer NOT NULL CHECK ("step" BETWEEN 1 AND 3),
  "variant"   text NOT NULL CHECK ("variant" IN ('A','B')),
  -- Cohort codes this line covers, e.g. {C1,C2,C3}. Empty means every cohort, which is how
  -- Grade B works — one pair, whatever the week.
  "cohorts"   text[] NOT NULL DEFAULT '{}',
  "name"      text NOT NULL,
  "template"  text NOT NULL,
  "updatedAt" timestamp without time zone NOT NULL DEFAULT NOW(),
  "updatedBy" text
);

-- The lookup is segment + step + variant, then cohort membership.
CREATE INDEX IF NOT EXISTS "CampaignSubject_lookup_idx"
  ON "CampaignSubject" ("segment", "step", "variant");

-- One line per audience, so a lookup cannot find two and have to choose.
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignSubject_unique_idx"
  ON "CampaignSubject" ("segment", "step", "variant", "cohorts");
