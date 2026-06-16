import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
if (!match) { console.error('DATABASE_URL not found in .env'); process.exit(1); }
const sql = neon(match[1]);

// Roof covering material — producer-confirmable in the Grade Review panel.
// Stays NULL (rendered as "Unknown") until confirmed; only explicit high-risk
// coverings (flat-metal/tile/wood) are a carrier knockout. (Frank, Jun 2026)
await sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "roofType" TEXT`;

console.log('✅ Column added: roofType');
