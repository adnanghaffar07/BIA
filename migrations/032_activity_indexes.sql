-- 032: the two indexes Activity has never had.
--
-- Activity carried ONLY its primary key (Activity_pkey on id). Every read of it in the
-- application filters by "leadId" and almost every one orders by "createdAt" — neither of
-- which the primary key helps with, so both were sequential scans over the whole table.
--
-- At 4,025 rows that is invisible. Activity grows 250-1,200 rows a week with no email
-- traffic at all, and the outreach event stream lands on top of that; at ~100k rows it is
-- a full table scan on every lead card open, presenting as a page that feels slow for no
-- visible reason. Cheaper to add now than to diagnose later.
--
-- Not CONCURRENTLY, deliberately: at this table size the build takes milliseconds and the
-- write lock is shorter than a round trip, whereas a failed CONCURRENTLY build leaves an
-- INVALID index behind that must be found and dropped by hand. The trade only favours
-- CONCURRENTLY on a table large enough for the lock to be felt. This one is not, yet.

-- 1. The lead card. storage.service.ts joins Activity on "leadId" and aggregates
--    ORDER BY "createdAt" DESC. Column order matters: equality column first, then the
--    sort column, so the index satisfies both the filter and the ordering in one scan.
--    DESC matches the query's direction — Postgres can read a btree backwards, so this
--    is a small win rather than a necessary one, but it costs nothing and mirrors
--    CallAttempt_lead_idx, which is the same shape for the same reason.
CREATE INDEX IF NOT EXISTS "Activity_lead_idx"
    ON "Activity" ("leadId", "createdAt" DESC);

-- 2. Time-windowed reads that are NOT scoped to one lead: the daily and weekly report
--    queries, and gradeHistory.service.ts's backfill, which orders the whole table by
--    "createdAt" ASC. Those cannot use the composite index above, because they have no
--    "leadId" to lead with.
CREATE INDEX IF NOT EXISTS "Activity_createdAt_idx"
    ON "Activity" ("createdAt");
