-- What makes an account "worked" (Frank, 24 Sep 2026 · fix 21)
--
-- Fix 21 turns on this definition: "no retroactive change to a WORKED account without
-- notifying Ruben". Everything else follows from where the line is drawn.
--
-- ── Why a view rather than a shared constant in the code ────────────────────
-- Two queries need it — grade changes and recaptures — and the driver here is a tagged
-- template with no way to splice a fragment in. The alternatives were to write the condition
-- out twice, or to build it by string concatenation. The first drifts the moment one copy is
-- edited; the second is how SQL injection gets written even when today's inputs are constant.
--
-- A view is the one form that is defined once, checked by the database, and impossible to
-- call with the wrong shape.
--
-- ── Why the definition is deliberately broad ────────────────────────────────
-- The cost of including an account nobody has touched is one extra line on a report. The
-- cost of missing one is precisely the failure Frank is describing — a producer opening a
-- card he worked and finding it silently different.
--
-- `status` alone is not enough: the skip-trace blast rewrites it, which is how a week holding
-- 61 rated accounts reported 48. A premium, a call, a hand edit or a send are each
-- independent evidence that a person has been here, and any one of them is enough.

CREATE OR REPLACE VIEW "WorkedLead" AS
  SELECT l."id"
    FROM "Lead" l
   WHERE l."status" IN ('rated','indicative_sent','pos_ran','quote_issued','referral','bound','lost')
      OR l."travelersPremium" IS NOT NULL
      OR l."plymouthPremium" IS NOT NULL
      -- Set whenever a person saves the card. Absent on older rows, which is why it is one
      -- signal among several rather than the test on its own.
      OR l."lastEditedBy" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "CallAttempt" a WHERE a."leadId" = l."id")
      OR EXISTS (SELECT 1 FROM "OutreachEvent" o WHERE o."leadId" = l."id");

COMMENT ON VIEW "WorkedLead" IS
  'Lead ids a person has actually worked — rated, called, quoted, hand-edited or mailed. The definition fix 21 turns on, kept in one place so the daily report and anything else asking the question cannot disagree (Frank, 24 Sep 2026).';
