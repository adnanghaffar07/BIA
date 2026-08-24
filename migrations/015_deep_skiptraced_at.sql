-- Frank Aug-2026: timestamp of the last Tracerfy ENHANCED (deep) skip trace. Set only on
-- the deep run so the lead card can hide the Deep Skip Trace button (preventing a repeat
-- 15-credit charge) and show a "Deep skip traced · date" badge instead.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "deepSkipTracedAt" TIMESTAMP;
