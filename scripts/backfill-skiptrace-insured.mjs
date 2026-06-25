/**
 * FREE backfill — re-applies the skip-trace → Insured Info mapping to leads that
 * were already skip-traced, using the stored skipTraceData (no REAPI calls/credits).
 * Pulls through co-insured ("people on loan") names + DOB (estimated from age) and
 * fills empty phone/email slots. Never clobbers producer-entered values.
 *
 * Usage:  node scripts/backfill-skiptrace-insured.mjs [--dry-run]
 */
import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry-run');
const url = readFileSync('.env', 'utf-8').match(/DATABASE_URL=([^\n]+)/)[1].trim().replace(/^["']|["']$/g, '');
const sql = neon(url);
const pool = new Pool({ connectionString: url });

const estDob = (age) => { const a = parseInt(String(age), 10); return a > 0 && a < 120 ? `${new Date().getFullYear() - a}-01-01` : undefined; };

function patchFromPersons(persons, lead) {
  const list = Array.isArray(persons) ? persons : [];
  if (!list.length) return {};
  const o1First = String(lead.owner1FirstName ?? '').toLowerCase().trim();
  const o1Last = String(lead.owner1LastName ?? '').toLowerCase().trim();
  const primary = list.find((p) => String(p.firstName ?? '').toLowerCase() === o1First && String(p.lastName ?? '').toLowerCase() === o1Last) ?? list[0];
  const coInsured = list.find((p) => p !== primary && o1Last && String(p.lastName ?? '').toLowerCase() === o1Last) ?? list.find((p) => p !== primary);

  // flat contact union for empty phone/email slots
  const phones = [], emails = [];
  for (const p of list) {
    for (const ph of p.phones ?? []) { const n = typeof ph === 'string' ? ph : ph?.phone; if (n) phones.push(String(n)); }
    for (const em of p.emails ?? []) { const e = typeof em === 'string' ? em : em?.email; if (e) emails.push(String(e)); }
  }
  const uPh = [...new Set(phones)], uEm = [...new Set(emails)];

  const patch = {};
  if (coInsured) {
    if (!lead.owner2FirstName && coInsured.firstName) patch.owner2FirstName = coInsured.firstName;
    if (!lead.owner2LastName && coInsured.lastName) patch.owner2LastName = coInsured.lastName;
  }
  if (!lead.owner1Dob && primary?.age) { const d = estDob(primary.age); if (d) patch.owner1Dob = d; }
  if (!lead.owner2Dob && coInsured?.age) { const d = estDob(coInsured.age); if (d) patch.owner2Dob = d; }
  if (!lead.phone1 && uPh[0]) patch.phone1 = uPh[0];
  if (!lead.phone2 && uPh[1]) patch.phone2 = uPh[1];
  if (!lead.email1 && uEm[0]) patch.email1 = uEm[0];
  if (!lead.email2 && uEm[1]) patch.email2 = uEm[1];
  return patch;
}

const leads = await sql`
  SELECT "propertyId","owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
         "owner1Dob","owner2Dob","phone1","phone2","email1","email2","skipTraceData"
  FROM "Lead" WHERE "skipTraced" = true AND "skipTraceData" IS NOT NULL`;

console.log(`\n👥 Skip-trace Insured backfill ${DRY ? '(DRY RUN)' : ''} — ${leads.length} traced leads`);
let updated = 0, coIns = 0, dob = 0;
for (const l of leads) {
  const raw = typeof l.skipTraceData === 'string' ? JSON.parse(l.skipTraceData) : l.skipTraceData;
  const patch = patchFromPersons(raw?.persons ?? [], l);
  if (!Object.keys(patch).length) continue;
  if (patch.owner2LastName || patch.owner2FirstName) coIns++;
  if (patch.owner1Dob || patch.owner2Dob) dob++;
  if (!DRY) {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    await pool.query(`UPDATE "Lead" SET ${sets}, "updatedAt" = NOW() WHERE "propertyId" = $${keys.length + 1}`,
      [...keys.map((k) => patch[k]), l.propertyId]);
  }
  updated++;
}
console.log(`  ${DRY ? 'would update' : 'updated'} ${updated}   co-insured filled ${coIns}   DOB filled ${dob}`);
console.log(DRY ? '\n  (dry run)' : '\n✅ Done (free — no credits).');
await pool.end();
