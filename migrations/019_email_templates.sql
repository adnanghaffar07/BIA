-- Reusable email templates for campaign sequences.
--
-- Kept in OUR database rather than the sending platform's, which was the first choice
-- until it was tested. POST /email-templates accepts a subject and silently discards
-- it: the stored record comes back with only id, name, body and organization. A
-- template that cannot carry its own subject line is half an email, and the platform
-- also offers no PATCH and no GET-by-id, so editing one would mean delete-and-recreate
-- with a new id. None of that is worth inheriting for a feature whose whole point is
-- that a producer writes copy once and reuses it.
--
-- Body is TEXT, not VARCHAR: cold-outreach copy runs to several paragraphs and a length
-- cap here would be discovered by a producer losing the end of an email they just wrote.

CREATE TABLE IF NOT EXISTS "EmailTemplate" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "subject"     TEXT NOT NULL DEFAULT '',
  "body"        TEXT NOT NULL DEFAULT '',
  -- Who saved it, for provenance in a shared agency account. Not an owner: templates
  -- are deliberately visible to everyone, since the point is reuse across producers.
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Names are how a template is chosen from a list, so duplicates would make the picker
-- ambiguous. Case-insensitive because "Renewal outreach" and "renewal outreach" are the
-- same template to everyone except the database.
CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_name_key"
  ON "EmailTemplate" (LOWER("name"));

CREATE INDEX IF NOT EXISTS "EmailTemplate_updatedAt_idx"
  ON "EmailTemplate" ("updatedAt" DESC);
