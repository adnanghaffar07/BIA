-- The co-insured, verified against the tax roll — the same way the insured already is.
--
-- Frank, 2 Oct 2026: verify the co-insured name against WIIP as well as the insured.
--
-- ── Why this is columns and not a new lookup ───────────────────────────────
-- WIIP never returned "the owner". It returns the whole deed line, both names, and we have
-- been storing it verbatim in ownerVerifyName all along: "SCOTTO, DIANE & MICHAEL". So the
-- second owner has been verified since the first blast ran — the comparison just had
-- nowhere to live, and could only be seen by running a report.
--
-- That is the actual gap Frank is pointing at. The insured's answer sits on the card as
-- ownerVerifyStatus and can be filtered and counted; the co-insured's existed only inside
-- the override tool, so "show me every card where the co-insured disagrees with the roll"
-- was not a question anybody could ask. On 2 Oct that was 118 cards.
--
-- No new external calls: every value below is derived from a WIIP record we already hold.
--
-- coInsuredVerifyStatus is one of:
--   match          the card and the roll name the same second owner
--   partial        close but not exact — a spelling, a middle name, a maiden name
--   mismatch       the roll names a DIFFERENT person than the card does
--   found_on_wiip  the roll names a second owner and the card names nobody
--   none_on_roll   the roll names only one person
--   entity         a trust or company, so there is no second person to name
--
-- found_on_wiip is Frank's own wording from item 8, and it is deliberately NOT 'mismatch'.
-- There is no disagreement there, there is a gap — and the two want opposite actions. One
-- is a correction somebody must weigh; the other is free.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "coInsuredVerifyStatus" text,
  ADD COLUMN IF NOT EXISTS "coInsuredVerifyName"   text,
  ADD COLUMN IF NOT EXISTS "coInsuredVerifyDetail" text,
  ADD COLUMN IF NOT EXISTS "coInsuredVerifyAt"     timestamp without time zone;

-- The filter Frank asked for: every card whose co-insured disagrees with the tax roll.
CREATE INDEX IF NOT EXISTS "Lead_coInsuredVerifyStatus_idx"
  ON "Lead" ("coInsuredVerifyStatus")
  WHERE "coInsuredVerifyStatus" IS NOT NULL;
