-- Every skip trace: what we sent, what came back, what it cost.
--
-- Frank, 1 Oct 2026: "Log every trace: what we sent, what came back, credits charged, so a
-- run that fails is caught the same day. The C1 blast deep trace didn't run and nobody knew."
--
-- Two separate failures made that possible and this table addresses both.
--
-- The first is the one he names: a blast can do nothing and leave no trace of having done
-- nothing. The payload on the card is overwritten by the next run, so a lead that was traced
-- badly and retraced well looks the same as one traced well first time, and a lead that was
-- never traced at all looks the same as one the vendor had nothing for.
--
-- The second only became visible while writing this. He asked whether the vendor picks the
-- owner from the address alone, and the honest answer was that we could not tell, because
-- the request was never recorded. It is worse than that: BatchData's request carries ONLY
-- the property address — no name is sent at all — while Tracerfy sends first and last. So
-- for one of our two vendors the answer is yes, always, and nothing in the system said so.
-- sentFirstName being null on a row is that fact, per trace, permanently.
CREATE TABLE IF NOT EXISTS "SkipTraceLog" (
  "id"            text PRIMARY KEY,
  "leadId"        text NOT NULL,
  "propertyId"    text,
  "provider"      text NOT NULL,
  -- Which product was bought. A deep/enhanced trace and a standard one cost differently and
  -- answer differently, and "we traced it" without this is not a statement about either.
  "tier"          text,
  -- Groups the traces of one blast so a run can be summarised, and so a run that produced
  -- nothing can be seen to have happened at all.
  "runId"         text,

  -- ── What we sent ────────────────────────────────────────────────────────
  -- Null first/last is not missing data: it records that no name was sent.
  "sentFirstName" text,
  "sentLastName"  text,
  "sentAddress"   text,
  "sentCity"      text,
  "sentState"     text,
  "sentZip"       text,
  -- Tracerfy retries with the first token when a compound first name misses, so one trace
  -- can be two requests. Stored because a 2 here changes what a miss means.
  "requests"      integer NOT NULL DEFAULT 1,

  -- ── What came back ──────────────────────────────────────────────────────
  -- 'hit' | 'miss' | 'error'. A miss is an answer; an error is not, and collapsing the two
  -- is how an outage gets written down as "this household cannot be found".
  "outcome"       text NOT NULL,
  "returnedName"  text,
  "personCount"   integer,
  "phoneCount"    integer,
  "emailCount"    integer,
  "credits"       numeric,
  "errorMessage"  text,
  "durationMs"    integer,

  "createdAt"     timestamp without time zone NOT NULL DEFAULT NOW(),
  "createdBy"     text
);

CREATE INDEX IF NOT EXISTS "SkipTraceLog_leadId_idx" ON "SkipTraceLog" ("leadId", "createdAt" DESC);
-- The same-day check Frank asked for reads this: one run, how many hits, how many errors.
CREATE INDEX IF NOT EXISTS "SkipTraceLog_runId_idx" ON "SkipTraceLog" ("runId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SkipTraceLog_createdAt_idx" ON "SkipTraceLog" ("createdAt" DESC);
