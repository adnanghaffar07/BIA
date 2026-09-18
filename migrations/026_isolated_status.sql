-- 026: the "isolated" status (register A41)
--
-- Frank, 17 Sep 2026: leads that cannot be reached should be parked somewhere visible
-- rather than left sitting in the working queue looking workable.
--
-- The target population is Grade A leads with no insured email: eligible to quote, and
-- impossible to email. They are not lost and not out of appetite — they are waiting on a
-- contact detail, and until one turns up they should not read as part of the send list.
--
-- WHY THE PREVIOUS STATUS IS KEPT
-- 31 of the 34 in the 10/05 week are 'rated' and one is 'referral' — a producer has
-- already done the work. Overwriting that with 'isolated' would erase it, and the email
-- cadence depends on it: a rated lead gets an indicative price in email 2 and an unrated
-- one cannot. Storing what the status WAS makes isolation reversible and keeps the
-- rated/new split intact for whenever the lead becomes reachable again.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "isolatedAt"         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "isolatedFromStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "isolatedReason"     TEXT;

-- The only query this has to be fast for: "show me the isolated ones".
CREATE INDEX IF NOT EXISTS "Lead_isolatedAt_idx" ON "Lead" ("isolatedAt")
  WHERE "isolatedAt" IS NOT NULL;
