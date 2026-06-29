/**
 * FREE re-grade — recomputes A/B/C/D for every lead using the same rules as
 * src/services/grade.service.ts (roof >20 yr unconfirmed, carrier both-ineligible
 * → D, flood SFHA → D / shaded-X → C, missing pertinent fields). Uses STORED
 * carrier-eligibility + flood data (no FEMA/REAPI calls, no credits). Honors
 * manual grade overrides. Mirrors grade.service so the app + DB agree.
 *
 * Usage:  node scripts/regrade.mjs [--dry-run]
 */
import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry-run');
const url = readFileSync('.env', 'utf-8').match(/DATABASE_URL=([^\n]+)/)[1].trim().replace(/^["']|["']$/g, '');
const sql = neon(url);
const pool = new Pool({ connectionString: url });
const YEAR = 2026;

// Mirrors CRITICAL_FIELDS in grade.service.ts (flat DB column names).
const FIELDS = [
  { k: 'owner1LastName' }, { k: 'addressStreet' }, { k: 'addressZip' }, { k: 'addressCity' },
  { k: 'estimatedValue' }, { k: 'yearBuilt' }, { k: 'squareFeet' },
  { k: 'roofYear', applies: (l) => { const yb = Number(l.yearBuilt); return !yb || (YEAR - yb) > 20; } },
  { k: 'propertyType' }, { k: 'bedrooms' },
];

function floodCap(l) {
  if (l.floodSfha === true) return 'D';
  const z = String(l.floodZoneType ?? '').trim().toUpperCase();
  const sub = String(l.floodZoneSubtype ?? '').toUpperCase();
  if (/^(A|V)/.test(z)) return 'D';
  if (z === 'X' && /0\.2\s*PCT/.test(sub)) return 'C';
  if (z === 'X500' || z.includes('0.2') || sub.includes('SHADED')) return 'C';
  if (l.floodZone === true && z === 'X') return 'C';
  return null;
}

function computeGrade(l) {
  // manual override wins (mirrors grade.service: grade = manualGrade || computed)
  if (l.manualGrade && ['A', 'B', 'C', 'D'].includes(l.manualGrade)) return l.manualGrade;
  const fc = floodCap(l);
  if (fc === 'D') return 'D';
  const passesAny = l.travelersEligible !== 'ineligible' || l.plymouthEligible !== 'ineligible';
  if (!passesAny) return 'D';
  const missing = FIELDS.filter((f) => (!f.applies || f.applies(l))
    && (l[f.k] === null || l[f.k] === undefined || l[f.k] === '')).length;
  let g = missing === 0 ? 'A' : missing === 1 ? 'B' : 'C';
  if (fc === 'C' && (g === 'A' || g === 'B')) g = 'C';
  return g;
}

const leads = await sql`
  SELECT "propertyId","grade","manualGrade","yearBuilt","roofYear","owner1LastName",
         "addressStreet","addressZip","addressCity","estimatedValue","squareFeet",
         "propertyType","bedrooms","travelersEligible","plymouthEligible",
         "floodSfha","floodZone","floodZoneType","floodZoneSubtype"
  FROM "Lead"`;

const before = { A: 0, B: 0, C: 0, D: 0 }, after = { A: 0, B: 0, C: 0, D: 0 };
let changed = 0, aToB = 0;
for (const l of leads) {
  before[l.grade] = (before[l.grade] || 0) + 1;
  const g = computeGrade(l);
  after[g] = (after[g] || 0) + 1;
  if (g !== l.grade) {
    changed++;
    if (l.grade === 'A' && g === 'B') aToB++;
    if (!DRY) await pool.query(`UPDATE "Lead" SET "grade"=$1,"updatedAt"=NOW() WHERE "propertyId"=$2`, [g, l.propertyId]);
  }
}

console.log(`\n🎯 Re-grade ${DRY ? '(DRY RUN)' : ''} — ${leads.length} leads`);
console.log('  before:', JSON.stringify(before));
console.log('  after :', JSON.stringify(after));
console.log(`  changed ${changed}   (A→B: ${aToB})`);
console.log(DRY ? '\n  (dry run — nothing written)' : '\n✅ Re-grade applied (free).');
await pool.end();
