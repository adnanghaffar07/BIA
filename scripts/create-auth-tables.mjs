import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
if (!match) { console.error('DATABASE_URL not found in .env'); process.exit(1); }

const sql = neon(match[1]);

await sql`
  CREATE TABLE IF NOT EXISTS "User" (
    "id"           TEXT         NOT NULL PRIMARY KEY,
    "email"        TEXT         NOT NULL UNIQUE,
    "passwordHash" TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "role"         TEXT         NOT NULL DEFAULT 'admin',
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdBy"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS "Session" (
    "id"        TEXT         NOT NULL PRIMARY KEY,
    "userId"    TEXT         NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "token"     TEXT         NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

await sql`CREATE INDEX IF NOT EXISTS "Session_token_idx" ON "Session"("token")`;

console.log('✅ User and Session tables created.');

const existing = await sql`SELECT id FROM "User" WHERE role = 'superadmin' LIMIT 1`;
if (existing.length === 0) {
  console.log('ℹ️  No SuperAdmin found — run: node scripts/seed-superadmin.mjs');
} else {
  console.log('✅ SuperAdmin already exists.');
}
