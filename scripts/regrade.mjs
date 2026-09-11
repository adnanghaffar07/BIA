/**
 * FREE re-grade — recomputes A/B/C/D for every lead using the same rules as
 * src/services/grade.service.ts (roof >20 yr unconfirmed, carrier both-ineligible
 * → D, flood SFHA → D / shaded-X → C, missing pertinent fields). Uses STORED
 * carrier-eligibility + flood data (no FEMA/REAPI calls, no credits). Honors
 * manual grade overrides.
 *
 * ⚠  QUARANTINED — Frank Sep-2026, pre-launch checklist Tier 3. DO NOT RUN.
 *
 * It no longer mirrors grade.service. That service exempts condos from the
 * roof-age field (CONDO_EXEMPT_FIELDS, grade.service.ts) because a condo owner
 * does not insure the roof; this script has no such notion. 1,200 of the 1,449
 * Grade A leads are condos, so a write pass moves Grade A from 1,449 to 448 —
 * 769 leads out of A, including most of the Grade-A-with-email set the 9/14
 * pilot sends to. Measured 09 Sep 2026 by dry run.
 *
 * The app re-grades on every enrichment pass, so this script is not needed to
 * keep the DB correct. Reconcile it against grade.service (condo exemption
 * first) or delete it. Until then a write pass requires an explicit override
 * flag so it cannot be run from muscle memory.
 *
 * Usage:  node scripts/regrade.mjs --dry-run          (safe, reports only)
 *         node scripts/regrade.mjs --force-write-i-have-reconciled-condos
 */
import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry-run');
const OVERRIDE = process.argv.includes('--force-write-i-have-reconciled-condos');
const EOL = String.fromCharCode(10);

// Refuse to write without the override. See the quarantine note above: this
// script downgrades every condo it touches, and the pilot list is 80% condo.
if (!DRY && !OVERRIDE) {
  console.error([
    '',
    '  ⛔  regrade.mjs is quarantined and will not write.',
    '',
    '  It downgrades every condo it touches — a write pass takes Grade A from',
    '  1,449 to 448 and would gut the 9/14 pilot list. The live app already',
    '  re-grades on enrichment, so this script is not needed.',
    '',
    '  Report only:  node scripts/regrade.mjs --dry-run',
    '',
    '  If you have genuinely reconciled it against grade.service.ts (start with',
    '  the condo exemption in CONDO_EXEMPT_FIELDS), re-run with',
    '  --force-write-i-have-reconciled-condos',
    '',
  ].join(EOL));
  process.exit(1);
}
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
