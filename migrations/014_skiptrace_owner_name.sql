-- Frank Aug-2026: the insured name Tracerfy returned on the last skip trace. When it
-- differs from the on-file owner1 name, the card surfaces both + an override button, and
-- the QC "Name Mismatch" report lists them. Stored, never auto-applied.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "skipTraceOwnerName" TEXT;
