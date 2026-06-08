/**
 * Creates the initial SuperAdmin account.
 * Run once: node scripts/seed-superadmin.mjs
 */
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
if (!match) { console.error('DATABASE_URL not found in .env'); process.exit(1); }

const sql = neon(match[1]);

const SUPERADMIN = {
  id: crypto.randomUUID(),
  email: 'admin@burlingtonins.com',
  password: 'BIA@SuperAdmin2026!',
  name: 'BIA Super Admin',
  role: 'superadmin',
};

const existing = await sql`SELECT id FROM "User" WHERE email = ${SUPERADMIN.email}`;
if (existing.length > 0) {
  console.log(`⚠️  SuperAdmin already exists: ${SUPERADMIN.email}`);
  process.exit(0);
}

const passwordHash = await bcrypt.hash(SUPERADMIN.password, 12);

await sql`
  INSERT INTO "User" ("id", "email", "passwordHash", "name", "role")
  VALUES (${SUPERADMIN.id}, ${SUPERADMIN.email}, ${passwordHash}, ${SUPERADMIN.name}, ${SUPERADMIN.role})
`;

console.log('✅ SuperAdmin created successfully.');
console.log('');
console.log('  Email:    ', SUPERADMIN.email);
console.log('  Password: ', SUPERADMIN.password);
console.log('');
console.log('⚠️  Change this password after first login.');
