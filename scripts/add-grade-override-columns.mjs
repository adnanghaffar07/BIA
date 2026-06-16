import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
if (!match) { console.error('DATABASE_URL not found in .env'); process.exit(1); }
const sql = neon(match[1]);

// ── A1: Manual grade override (producer upgrade/downgrade with a comment) ──────
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "manualGrade"          TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "gradeOverrideReason"  TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "gradeOverrideBy"      TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "gradeOverrideAt"      TIMESTAMP(3)`;

// ── A2: Revisit / future re-engagement ────────────────────────────────────────
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "revisitFlag" BOOLEAN NOT NULL DEFAULT false`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "revisitDate" TIMESTAMP(3)`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "revisitNote" TEXT`;

// ── A3: Lost-to-competitor price capture ──────────────────────────────────────
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "competitorCarrier" TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "competitorPremium" DOUBLE PRECISION`;

console.log('✅ Columns added: manualGrade, gradeOverrideReason, gradeOverrideBy, gradeOverrideAt, revisitFlag, revisitDate, revisitNote, competitorCarrier, competitorPremium');
