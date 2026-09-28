-- A suppression that is meant to end (Frank, 25 Sep 2026 · call outcomes)
--
-- "Not interested → re-contact 60 days before next renewal"
--
-- ── Why the existing table could not express this ───────────────────────────
-- Suppression has createdAt and releasedAt: on, and off once somebody turns it off. Both
-- of the outcomes that suppress — "not interested" and "do not call" — therefore landed in
-- exactly the same state, permanent until a person intervened.
--
-- They are not the same thing at all. "Do not call" is a standing instruction from the
-- customer and must never lapse. "Not interested" is a statement about THIS renewal, and
-- Frank wants that household approached again two months before the next one. Treating the
-- second as the first quietly retires a customer who only said no to one year's quote.
--
-- reviewAt is the date the suppression stops applying. NULL means permanent, which is the
-- right default: a suppression with no end date must not be guessed into one.

ALTER TABLE "Suppression"
  ADD COLUMN IF NOT EXISTS "reviewAt" TIMESTAMP;

COMMENT ON COLUMN "Suppression"."reviewAt" IS
  'When this suppression stops applying. NULL = permanent (do-not-call, complaints, binds). Set for "not interested", to 60 days before the next renewal (Frank, 25 Sep 2026).';

-- The daily question: which suppressions have come due?
CREATE INDEX IF NOT EXISTS "Suppression_review_idx"
  ON "Suppression" ("reviewAt") WHERE "reviewAt" IS NOT NULL AND "releasedAt" IS NULL;
