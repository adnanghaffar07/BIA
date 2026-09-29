-- Put a lead back in the calling queue (Frank, 29 Sep 2026).
--
-- On the launch call, having tested a few cards: "what's the best thing to get it back in
-- the queue? I want it back in the regular queue... I can't do undo." And then, on why it
-- matters beyond his own test rows: "what if something is done incorrectly or a mistake was
-- made and you wanted to get it back — things get stuck in here."
--
-- ── Why not simply widen the undo window ────────────────────────────────────
-- The undo is ten minutes on purpose, and Frank is the one who asked for it that way: it
-- exists for the five seconds after a wrong tap, where a number reads "Voicemail left" and
-- then "Bad number". Past that an attempt is a record of a real call. Widening the window
-- would quietly turn a call log into something a producer can edit, and the call log is what
-- the whole contactability rule is computed from.
--
-- So this does the opposite of an undo. It deletes nothing. The attempts stay exactly where
-- they are, and a separate, named, reasoned act says "start the calling story again from
-- here". Somebody reading the card afterwards sees both the calls and the decision to set
-- them aside — which is the thing a deletion would have destroyed.
--
-- ── Why it is a timestamp and not a status ──────────────────────────────────
-- Call status is DERIVED in callState(): the latest reaching outcome, else unreachable if
-- the four-attempt rule fires, else attempting, else not attempted. Writing a status here
-- would create a second answer to a question that already has one, and this project has
-- spent a fortnight removing exactly that.
--
-- A cut-off line has no such problem. callState keeps deriving what it always derived; it
-- just stops reading attempts from before the line. Calls logged after the return count
-- normally, so a lead returned to the queue and then dialled four more times goes unreachable
-- again on its own, with no special case anywhere.

ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "callQueueReturnedAt"     timestamp,
  ADD COLUMN IF NOT EXISTS "callQueueReturnedBy"     text,
  ADD COLUMN IF NOT EXISTS "callQueueReturnedReason" text;

COMMENT ON COLUMN "Lead"."callQueueReturnedAt" IS
  'Attempts before this moment are ignored when deriving call status. Set by a producer '
  'deliberately returning the lead to the queue; never cleared automatically.';

-- The phone queue reads "who is callable" constantly, and this column now sits in that
-- predicate. Partial, because the overwhelming majority of leads are NULL here and an index
-- over them would be mostly empty pages.
CREATE INDEX IF NOT EXISTS "Lead_callQueueReturnedAt_idx"
  ON "Lead" ("callQueueReturnedAt")
  WHERE "callQueueReturnedAt" IS NOT NULL;
