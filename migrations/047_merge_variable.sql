-- Merge variables whose value is the same for every homeowner (Abdullah, 30 Sep 2026).
--
-- The email copy uses names like {{agency_website}} and {{office_address}}. They are not
-- properties of a lead — every contact gets the identical string — so nothing in the CRM
-- produced them and the platform printed nothing. On 30 Sep that was five such names blank
-- across all eight live campaigns.
--
-- ── Why a table and not an AppConfig row ────────────────────────────────────
-- AppConfig already holds agency_website, and it also holds api_seeded and a Tracerfy
-- balance checkpoint. Deciding "a merge variable is an AppConfig row whose key happens to
-- look like one" would make the set of variables a guess about the shape of a string, and
-- the first setting somebody added with an underscore in it would join the emails.
--
-- A table says which rows are merge variables by existing, carries who set the value and
-- when — a figure that goes into thousands of emails deserves an author — and leaves
-- AppConfig to be what it is.
--
-- ── Why only the same-for-everyone kind lives here ──────────────────────────
-- Three kinds of variable turn up in this copy. This one. Per-homeowner values like
-- renewal_date, which are computed from the lead and cannot have a value typed for them —
-- one typed renewal date sent to every household reads perfectly and is wrong, which is
-- worse than a blank nobody can miss. And per-mailbox details like a producer licence
-- number, which belong in the sending signature because they change with the sender.
--
-- Only the first kind is safe to type a value for, so only the first kind is stored here.

CREATE TABLE IF NOT EXISTS "MergeVariable" (
  -- The name as the copy writes it, without braces: agency_website, not {{agency_website}}.
  "name"        text PRIMARY KEY,
  "value"       text NOT NULL,
  -- What it is for, shown beside it so somebody editing copy knows what they are inserting.
  "description" text,
  "updatedAt"   timestamp NOT NULL DEFAULT NOW(),
  "updatedBy"   text
);

-- The name has to be usable as {{name}}: letters, digits and underscores, starting with a
-- letter. A name with a space or a brace in it would sit in the table looking correct and
-- never match anything in any template.
ALTER TABLE "MergeVariable"
  DROP CONSTRAINT IF EXISTS "MergeVariable_name_shape";
ALTER TABLE "MergeVariable"
  ADD CONSTRAINT "MergeVariable_name_shape" CHECK ("name" ~ '^[a-zA-Z][a-zA-Z0-9_]*$');

-- agency_website has lived in AppConfig, read directly by mergeVars.agencyWebsite(). Move
-- it rather than leaving two places to set one value: the first time they disagreed, the
-- booking link and the signature would name different websites.
INSERT INTO "MergeVariable" ("name","value","description","updatedBy")
SELECT 'agency_website', "value", 'The agency website, used in the copy and the booking link.', 'migration 047'
  FROM "AppConfig" WHERE "key" = 'agency_website' AND COALESCE("value",'') <> ''
ON CONFLICT ("name") DO NOTHING;
