import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(match[1]);

await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "coastDistanceMiles" DOUBLE PRECISION`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "coastExposure" TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "varianceNotes" TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "varianceReason" TEXT`;
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "varianceAmount" DOUBLE PRECISION`;

console.log('✅ Columns added: coastDistanceMiles, coastExposure, varianceNotes, varianceReason, varianceAmount');
