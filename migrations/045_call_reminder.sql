-- Call reminders (Abdullah, 28 Sep 2026): "Ruben tries the numbers, gets no response, and
-- wants to try again in 10 or 15 minutes."
--
-- ── Why this is not CallAttempt.callbackAt ──────────────────────────────────
-- callbackAt is a time the HOMEOWNER agreed to. It is a commitment, it is only set on the
-- outcomes that need one, and "callbacks honoured" is a number somebody will eventually be
-- measured on. A reminder is the caller's own note to himself after nobody picked up, and
-- most of them will never be dialled at the minute they name.
--
-- Putting both in one column would make every "try again shortly" look like a promise to a
-- homeowner, and the first report on missed callbacks would be wrong by hundreds.
--
-- ── Why the time is computed on the server ──────────────────────────────────
-- dueAt is written as NOW() + an interval, never from a clock the browser sent. Two bugs in
-- this project came from a laptop's local time reaching a `timestamp without time zone`
-- column: a callback due today never appeared, and a stalled-run check compared a stored
-- local time against a UTC now and never fired. "In 15 minutes" is unambiguous and needs no
-- timezone at all.

CREATE TABLE IF NOT EXISTS "CallReminder" (
  "id"          TEXT PRIMARY KEY,
  "leadId"      TEXT NOT NULL,
  "propertyId"  TEXT,

  -- The number he was trying. Kept so the reminder reopens on the same one rather than
  -- making him pick again from ten, seven of which are DNC-flagged.
  "phone"       TEXT,

  "dueAt"       TIMESTAMP NOT NULL,
  "note"        TEXT,

  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Acted on: the call was made. Distinct from dismissed, which means "not now, drop it".
  -- Both end the reminder; only one of them is work done, and a queue that cannot tell them
  -- apart cannot report how much of it got worked.
  "doneAt"      TIMESTAMP,
  "doneBy"      TEXT,
  "dismissedAt" TIMESTAMP,
  "dismissedBy" TEXT
);

-- The only query that runs often: what is due and still open, soonest first.
CREATE INDEX IF NOT EXISTS "CallReminder_open_idx"
  ON "CallReminder" ("dueAt")
  WHERE "doneAt" IS NULL AND "dismissedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "CallReminder_lead_idx" ON "CallReminder" ("leadId");

COMMENT ON TABLE "CallReminder" IS
  'A caller''s own reminder to try a number again. NOT a callback the homeowner agreed to — that is CallAttempt.callbackAt (Abdullah, 28 Sep 2026).';
COMMENT ON COLUMN "CallReminder"."dueAt" IS
  'Written as NOW() + interval on the server. Never from a browser clock.';
