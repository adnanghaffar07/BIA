-- 030: per-attempt call logging (directive Sec. 10.5, 21 Sep 2026)
--
-- Frank: "Email events can be reconstructed from the email tool's logs weeks later. A
-- phone call Ruben does not log never happened and cannot be recovered."
--
-- WHY ONE ROW PER ATTEMPT AND NOT A COUNTER ON "Lead"
-- "Lead"."contactAttempts" already exists and is exactly the thing the directive rules
-- out: "'Couldn't reach them' is not data. 'Four attempts across three numbers over nine
-- days, two voicemails, one disconnected line' is."
--
-- A counter cannot say which number was tried, whether the same one was dialled four
-- times, whether anyone left a voicemail, or whether the gaps were nine days or ninety
-- minutes. Those are the facts that decide whether to keep calling, try the other number,
-- or give up — and the decision is made per lead by a person who was not on the earlier
-- calls.
--
-- WHY STATUS IS NOT A COLUMN HERE
-- not_attempted → attempting → contacted | unreachable is DERIVED from these rows, never
-- typed. A typed status drifts from the attempts underneath it the first time somebody
-- forgets to update it, and then the call queue is built on a field nobody trusts. The
-- rule lives in callLog.service.
--
-- An attempt is never edited or deleted. A wrong entry is corrected by a later attempt
-- with a note, so the sequence stays a record of what happened rather than of what someone
-- currently believes happened.

CREATE TABLE IF NOT EXISTS "CallAttempt" (
  "id"             TEXT PRIMARY KEY,
  "leadId"         TEXT NOT NULL,
  "propertyId"     TEXT,

  -- The number actually dialled, and where it came from on the card. "Which number on the
  -- card" is in the directive's field list because "we tried them twice" means nothing if
  -- both attempts hit the same disconnected line.
  "numberDialled"  TEXT NOT NULL,
  -- 'insured' | 'co_insured'
  "numberRole"     TEXT,
  -- 'phone1' | 'phone2' | 'owner2Phone' | 'trace' — the slot it was read from.
  "numberLabel"    TEXT,

  "attemptedAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "durationSeconds" INTEGER,

  -- no_answer | voicemail | bad_number | wrong_person
  -- callback_scheduled | quote_requested | not_interested | do_not_call
  "outcome"        TEXT NOT NULL,
  -- Set only by callback_scheduled, so the reminder has a time to fire at.
  "callbackAt"     TIMESTAMP,
  "notes"          TEXT,
  "calledBy"       TEXT,

  "createdAt"      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The queue reads "every attempt for this lead, newest first" on every render.
CREATE INDEX IF NOT EXISTS "CallAttempt_lead_idx" ON "CallAttempt" ("leadId", "attemptedAt" DESC);
-- A dead number must not be dialled again from any lead that happens to share it.
CREATE INDEX IF NOT EXISTS "CallAttempt_number_idx" ON "CallAttempt" ("numberDialled");
-- Daily activity reporting (Sec. 12) cuts by day and by caller.
CREATE INDEX IF NOT EXISTS "CallAttempt_when_idx" ON "CallAttempt" ("attemptedAt");

-- Numbers proven dead, so the next attempt picks a different one (Sec. 10.5: "Mark that
-- number invalid; try the next on the card"). Kept on the lead rather than deleted — a
-- disconnected line is a fact worth remembering at next renewal.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "invalidPhones" JSONB,
  -- Set when the derived rule says unreachable, purely so a report can filter on it
  -- cheaply. Never read to DECIDE anything — callLog.service recomputes from the attempts.
  ADD COLUMN IF NOT EXISTS "callUnreachableAt" TIMESTAMP;
