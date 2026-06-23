-- 005_skip_trace_data.sql
-- Store the full REAPI v2 SkipTrace response per lead (identity, phones, emails,
-- demographics, relationships, etc.). Read on the lead detail page; never
-- clobbered by REAPI property re-ingest (see CRM_ONLY_FIELDS in storage.service).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "skipTraceData" JSONB;
