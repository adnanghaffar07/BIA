// Throwaway: print working CTA landing-page links for a DEMO lead.
//
// Usage:  node scripts/_cta-demo-links.mjs            → create/refresh the demo lead + print links
//         node scripts/_cta-demo-links.mjs --clean    → remove the demo lead
//
// Uses a dedicated demo lead, never a real one: clicking these links applies the real
// disposition, and two of the six suppress the lead permanently. Pointing them at a
// customer would silently stop that household's outreach.
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const env = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const all = env('.env') + '\n' + env('.env.local');
const dbUrl = /DATABASE_URL\s*=\s*"?([^"\n]+)"?/.exec(all)?.[1]?.trim();
if (!dbUrl) throw new Error('DATABASE_URL not found in .env / .env.local');
const sql = neon(dbUrl);

const LEAD_ID = 'cta-demo-lead';
const BASE = process.env.BASE_URL || 'http://localhost:3000';

if (process.argv.includes('--clean')) {
  await sql`DELETE FROM "CtaResponse" WHERE "leadId" = ${LEAD_ID}`;
  await sql`DELETE FROM "Activity" WHERE "leadId" = ${LEAD_ID}`;
  await sql`DELETE FROM "OutreachEvent" WHERE "leadId" = ${LEAD_ID}`;
  await sql`DELETE FROM "Lead" WHERE "id" = ${LEAD_ID}`;
  console.log('Demo lead removed.');
  process.exit(0);
}

// Reset so the demo starts from a clean state every time — the previous run may have
// suppressed it.
await sql`DELETE FROM "CtaResponse" WHERE "leadId" = ${LEAD_ID}`;
await sql`DELETE FROM "Activity" WHERE "leadId" = ${LEAD_ID}`;
await sql`DELETE FROM "OutreachEvent" WHERE "leadId" = ${LEAD_ID}`;
await sql`DELETE FROM "Lead" WHERE "id" = ${LEAD_ID}`;
await sql`
  INSERT INTO "Lead" ("id","propertyId","addressStreet","addressCity","addressZip","rawData",
                      "updatedAt","effectiveDate","indicativeBandLow","indicativeBandHigh",
                      "campaignStatus","grade","owner1FirstName","owner1LastName")
  VALUES (${LEAD_ID}, 'CTA-DEMO', '1 Demo Way', 'Freehold', '07728', '{}'::jsonb,
          NOW(), '2026-11-12', 1900, 2400, 'queued', 'A', 'Demo', 'Homeowner')`;

// Same algorithm as src/lib/ctaToken.ts.
const secret = process.env.CTA_TOKEN_SECRET || 'bia-cta-dev-secret-not-for-production';
const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const body = b64(Buffer.from(JSON.stringify({ l: LEAD_ID, t: Math.floor(Date.now() / 1000) }), 'utf8'));
const token = `${body}.${b64(crypto.createHmac('sha256', secret).update(body).digest())}`;

const CTAS = [
  ['quote',     'Yes — send me a quote'],
  ['savings',   'What would I save?'],
  ['defer',     'Not now — check back before my renewal'],
  ['roof',      'My roof was replaced in the last 10 years'],
  ['no_thanks', 'No thanks'],
  ['not_mine',  'This is not my property'],
];

console.log('\nDemo lead: Demo Homeowner, 1 Demo Way, Freehold — band $1,900–$2,400\n');
for (const [key, label] of CTAS) {
  console.log(`  ${label}\n    ${BASE}/c/${token}?a=${key}\n`);
}
console.log('Each link applies its real disposition to the demo lead.');
console.log('Re-run this script to reset it; --clean to remove it.\n');
