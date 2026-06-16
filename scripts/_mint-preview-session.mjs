// Throwaway: mint a valid local session for preview verification, then print cookie + a lead id.
import { neon } from '@neondatabase/serverless';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

// Load DATABASE_URL from .env / .env.local
let dbUrl;
for (const f of ['../.env.local', '../.env']) {
  try {
    const env = readFileSync(new URL(f, import.meta.url), 'utf8');
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    if (m) { dbUrl = m[1].trim(); break; }
  } catch {}
}
if (!dbUrl) throw new Error('DATABASE_URL not found in .env/.env.local');

const sql = neon(dbUrl);
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'bia-crm-secret-change-in-production-2026'
);

const users = await sql`SELECT "id","email","name","role" FROM "User" WHERE "isActive" = true ORDER BY ("role" = 'superadmin') DESC LIMIT 1`;
if (!users.length) throw new Error('No active users in DB');
const u = users[0];

const expiresAt = new Date(Date.now() + 7 * 864e5);
const token = await new SignJWT({ sub: u.id, email: u.email, name: u.name, role: u.role })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('7d')
  .sign(SECRET);

await sql`INSERT INTO "Session" ("id","userId","token","expiresAt") VALUES (${crypto.randomUUID()}, ${u.id}, ${token}, ${expiresAt.toISOString()})`;

// Grab a lead to view — prefer one with a roof year / grade set
const leads = await sql`SELECT "id","grade" FROM "Lead" ORDER BY "createdAt" DESC LIMIT 1`;
const lead = leads[0];

console.log(JSON.stringify({
  user: { email: u.email, role: u.role },
  cookie: `bia_session=${token}`,
  leadId: lead?.id ?? null,
  leadGrade: lead?.grade ?? null,
}, null, 2));
