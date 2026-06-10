/**
 * One-time REAPI seed script — run directly with Node (bypasses auth middleware).
 * Usage: node scripts/seed-from-reapi.mjs
 *
 * What it does:
 *   1. Clears all existing demo/placeholder leads
 *   2. Fetches 50 Engine-1 (new purchase, last 90 days) + 50 Engine-2 (renewal 2022-2025)
 *   3. Saves + enriches all leads in Neon
 *   4. Sets api_seeded = true → REAPI never called again from the app
 */

import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

function readEnv(file) {
  try { return readFileSync(file, 'utf-8'); } catch { return ''; }
}
const env      = readEnv('.env');
const envLocal = readEnv('.env.local');

function getVar(key, content) {
  const m = content.match(new RegExp(`${key}=([^\\n]+)`));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

const DATABASE_URL = getVar('DATABASE_URL', env);
const REAPI_KEY    = getVar('NEXT_PUBLIC_REAL_ESTATE_API_KEY', envLocal);

if (!DATABASE_URL) { console.error('❌ DATABASE_URL not in .env'); process.exit(1); }
if (!REAPI_KEY)    { console.error('❌ NEXT_PUBLIC_REAL_ESTATE_API_KEY not in .env.local'); process.exit(1); }

const REAPI_BASE = 'https://api.realestateapi.com/v2';
const sql  = neon(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL });

// ─── Date helpers ─────────────────────────────────────────────────────────────

function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Coast distance ───────────────────────────────────────────────────────────

const COAST_PTS = [
  { name: 'Sandy Hook',           lat: 40.4674, lng: -74.0094 },
  { name: 'Long Branch',          lat: 40.3029, lng: -73.9874 },
  { name: 'Asbury Park',          lat: 40.2232, lng: -74.0122 },
  { name: 'Point Pleasant Beach', lat: 40.0956, lng: -74.0440 },
  { name: 'Seaside Heights',      lat: 39.9457, lng: -74.0785 },
  { name: 'Island Beach',         lat: 39.8312, lng: -74.1010 },
  { name: 'Ship Bottom (LBI)',    lat: 39.6440, lng: -74.1877 },
  { name: 'Atlantic City',        lat: 39.3643, lng: -74.4229 },
  { name: 'Ocean City',           lat: 39.2776, lng: -74.5746 },
  { name: 'Cape May',             lat: 38.9351, lng: -74.9060 },
];

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcCoast(lat, lng) {
  if (!lat || !lng) return { dist: null, exposure: null };
  let min = Infinity, nearest = COAST_PTS[0];
  for (const p of COAST_PTS) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < min) { min = d; nearest = p; }
  }
  const dist = Math.round(min * 10) / 10;
  const exposure = dist < 0.5 ? 'extreme' : dist < 2 ? 'high' : dist < 5 ? 'moderate' : 'low';
  return { dist, exposure };
}

// ─── Carrier eligibility ─────────────────────────────────────────────────────

function checkCarriers(zip, yearBuilt, estimatedValue, pool2) {
  const roofAge = 2026 - (yearBuilt || 2000);
  const val = estimatedValue || 0;

  let tStatus = 'eligible';
  const tNotes = [];
  if (roofAge > 20) { tStatus = 'review'; tNotes.push(`Roof age ${roofAge} yrs — inspection may be required`); }
  if (val > 1500000) { tStatus = tStatus === 'eligible' ? 'review' : tStatus; tNotes.push('High-value home — HNW review required'); }
  if (pool2) tNotes.push('Pool present — liability endorsement required');

  let pStatus = 'eligible';
  const pNotes = [];
  if (roofAge > 25) { pStatus = 'ineligible'; pNotes.push(`Roof age ${roofAge} yrs exceeds Plymouth Rock limit`); }
  if (val > 2000000) { pStatus = 'ineligible'; pNotes.push('Value exceeds Plymouth Rock maximum ($2M)'); }

  const passesAny = tStatus !== 'ineligible' || pStatus !== 'ineligible';
  return { tStatus, tNotes, pStatus, pNotes, passesAny };
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function calcPricing(estimatedValue, squareFeet, yearBuilt, hasPool, coastExposure) {
  const val = estimatedValue || 300000;
  const sqft = squareFeet || 1800;
  const roofAge = 2026 - (yearBuilt || 2000);
  let base = val * 0.0035;
  if (roofAge > 15) base *= 1.15;
  if (roofAge > 20) base *= 1.20;
  if (sqft > 3000) base *= 1.10;
  if (hasPool) base *= 1.05;
  if (coastExposure === 'extreme') base *= 1.35;
  else if (coastExposure === 'high') base *= 1.20;
  else if (coastExposure === 'moderate') base *= 1.08;
  const expected = Math.round(base / 50) * 50;
  return { low: Math.round(expected * 0.85 / 50) * 50, expected, high: Math.round(expected * 1.20 / 50) * 50, confidence: Math.max(30, 85 - (roofAge > 20 ? 10 : 0)) };
}

// ─── Grading ─────────────────────────────────────────────────────────────────

function calcGrade(lead, passesAny) {
  if (!passesAny) return 'D';
  const missing = [lead.owner1LastName, lead.addressStreet, lead.addressZip, lead.estimatedValue, lead.yearBuilt, lead.squareFeet].filter(f => !f).length;
  if (missing === 0) return 'A';
  if (missing === 1) return 'B';
  return 'C';
}

// ─── Pipeline engine ──────────────────────────────────────────────────────────

function getEngine(property) {
  const d = property.recordingDate || property.lastSaleDate;
  if (!d) return null;
  const dt = new Date(d);
  const e1From = new Date(offsetDate(-90));
  const e1To   = new Date();
  const e2From = new Date('2022-01-01');
  const e2To   = new Date('2025-12-31');
  if (dt >= e1From && dt <= e1To) return 1;
  if (dt >= e2From && dt <= e2To) return 2;
  return null;
}

// ─── DB helper ────────────────────────────────────────────────────────────────

function toSql(v) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function slimRaw(p) {
  const { salesHistory, taxHistory, priorMortgages, currentMortgages, ownerHistory, liens, ...rest } = p ?? {};
  return { ...rest, currentMortgage: Array.isArray(currentMortgages) ? (currentMortgages[0] ?? null) : null };
}

async function saveProperty(property) {
  const pid = property.propertyId || property.id;
  if (!pid) return;

  const lat = property.latitude ? parseFloat(property.latitude) : null;
  const lng = property.longitude ? parseFloat(property.longitude) : null;
  const coast = calcCoast(lat, lng);
  const zip = property.address?.zip || '';
  const yearBuilt = property.yearBuilt ? parseInt(property.yearBuilt) : null;
  const estimatedValue = property.estimatedValue ? parseFloat(property.estimatedValue) : null;
  const squareFeet = property.squareFeet ? parseInt(property.squareFeet) : null;
  const carriers = checkCarriers(zip, yearBuilt, estimatedValue, property.pool);
  const pricing = calcPricing(estimatedValue, squareFeet, yearBuilt, property.pool, coast.exposure);

  const flat = {
    id: pid,
    propertyId: pid,
    addressStreet: property.address?.street || property.address?.address || '',
    addressCity: property.address?.city || '',
    addressState: property.address?.state || 'NJ',
    addressZip: zip,
    addressCounty: property.address?.county || null,
    addressFull: property.address?.address || null,
    propertyType: property.propertyType || null,
    propertyUse: property.propertyUse || null,
    landUse: property.landUse || null,
    yearBuilt,
    squareFeet,
    lotSquareFeet: property.lotSquareFeet ? parseInt(property.lotSquareFeet) : null,
    bedrooms: property.bedrooms ? parseInt(property.bedrooms) : null,
    bathrooms: property.bathrooms ? parseFloat(property.bathrooms) : null,
    stories: property.stories ? parseFloat(property.stories) : null,
    garage: property.garage ?? null,
    pool: property.pool ?? null,
    deck: property.deck ?? null,
    patio: property.patio ?? null,
    basement: property.basement ?? null,
    airConditioning: property.airConditioningAvailable ?? null,
    estimatedValue,
    assessedValue: property.assessedValue ? parseFloat(property.assessedValue) : null,
    lastSaleAmount: property.lastSaleAmount ? parseFloat(String(property.lastSaleAmount).replace(/[^0-9.]/g, '')) : null,
    lastSaleDate: property.lastSaleDate || null,
    estimatedEquity: property.estimatedEquity ? parseFloat(property.estimatedEquity) : null,
    openMortgageBalance: property.openMortgageBalance ? parseFloat(property.openMortgageBalance) : null,
    lenderName: property.lenderName || null,
    mortgageType: property.mortgageType || null,
    owner1LastName: property.owner1LastName || null,
    owner1FirstName: property.owner1FirstName || null,
    companyName: property.companyName || null,
    ownerOccupied: property.ownerOccupied ?? null,
    corporateOwned: property.corporateOwned ?? null,
    absenteeOwner: property.absenteeOwner ?? null,
    investorBuyer: property.investorBuyer ?? null,
    vacant: property.vacant ?? null,
    preForeclosure: property.preForeclosure ?? null,
    foreclosure: property.foreclosure ?? null,
    reo: property.reo ?? null,
    floodZone: property.floodZone ?? null,
    floodZoneType: property.floodZoneType || null,
    latitude: lat,
    longitude: lng,
    fips: property.fips || null,
    apn: property.apn || null,
    recordingDate: property.recordingDate || null,
    engine: getEngine(property),
    status: 'new',
    grade: null, // set below
    travelersEligible: carriers.tStatus,
    travelersNotes: JSON.stringify(carriers.tNotes),
    plymouthEligible: carriers.pStatus,
    plymouthNotes: JSON.stringify(carriers.pNotes),
    lowPremium: pricing.low,
    expectedPremium: pricing.expected,
    highPremium: pricing.high,
    pricingConfidence: pricing.confidence,
    coastDistanceMiles: coast.dist,
    coastExposure: coast.exposure,
    rawData: JSON.stringify(slimRaw(property)),
  };

  flat.grade = calcGrade(flat, carriers.passesAny);

  const now = new Date().toISOString();
  const keys = Object.keys(flat);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const vals = keys.map(k => toSql(flat[k]));
  const placeholders = keys.map((_, i) => `$${i+1}`).join(', ');
  const setClauses = keys
    .filter(k => k !== 'id' && k !== 'propertyId')
    .map(k => `"${k}" = EXCLUDED."${k}"`)
    .join(', ');

  const q = `
    INSERT INTO "Lead" (${cols}, "createdAt", "updatedAt")
    VALUES (${placeholders}, $${keys.length+1}, $${keys.length+2})
    ON CONFLICT ("id") DO UPDATE SET ${setClauses}, "updatedAt" = EXCLUDED."updatedAt"
  `;
  await pool.query(q, [...vals, now, now]);
  return flat.grade;
}

// ─── Fetch REAPI ──────────────────────────────────────────────────────────────

// ─── BIA target ZIP codes ─────────────────────────────────────────────────────
const TARGET_ZIPS = ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'];

async function fetchReapi(filters, label) {
  console.log(`  📤 Calling REAPI — ${label}...`);
  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': REAPI_KEY,
    },
    body: JSON.stringify({
      ids_only: false,
      obfuscate: false,
      summary: false,
      state: 'NJ',
      zip: TARGET_ZIPS,          // ← only these 10 ZIPs
      flood_zone: false,
      vacant: false,
      pre_foreclosure: false,
      foreclosure: false,
      reo: false,
      ...filters,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`REAPI ${res.status}: ${err}`);
  }

  const data = await res.json();
  const props = data.data || [];
  console.log(`  📥 Got ${props.length} properties (API says total: ${data.resultCount ?? '?'})`);
  return props;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n🌱 BIA REAPI One-Time Seed');
console.log('━'.repeat(50));

// 1. Clear demo data
console.log('\n🗑️  Clearing placeholder leads...');
const before = await sql`SELECT COUNT(*) AS c FROM "Lead"`;
console.log(`   Found ${before[0].c} existing leads — deleting...`);
await sql`DELETE FROM "Activity"`;
await sql`DELETE FROM "Lead"`;

// 2. Fetch from REAPI
console.log('\n📡 Fetching from RealEstateAPI...');
let e1Props = [], e2Props = [];

try {
  e1Props = await fetchReapi({
    size: 50,
    first_mortgage_recording_date_min: offsetDate(-90),
    first_mortgage_recording_date_max: offsetDate(0),
  }, 'Engine 1 — New Purchase (last 90 days)');
} catch (err) {
  console.error('  ❌ Engine 1 failed:', err.message);
}

try {
  e2Props = await fetchReapi({
    size: 50,
    first_mortgage_recording_date_min: '2022-01-01',
    first_mortgage_recording_date_max: offsetDate(-90),
  }, 'Engine 2 — Renewal (2022–2025)');
} catch (err) {
  console.error('  ❌ Engine 2 failed:', err.message);
}

const allProps = [...e1Props, ...e2Props];
if (allProps.length === 0) {
  console.error('\n❌ No properties returned from REAPI. Check API key and plan status.');
  process.exit(1);
}

// 3. Save + enrich
console.log(`\n💾 Saving ${allProps.length} properties to Neon...`);
const grades = { A: 0, B: 0, C: 0, D: 0 };
let saved = 0;

for (const prop of allProps) {
  const grade = await saveProperty(prop);
  if (grade) { grades[grade] = (grades[grade] || 0) + 1; saved++; }
}

// 4. Set seed lock
await sql`
  CREATE TABLE IF NOT EXISTS "AppConfig" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ DEFAULT NOW()
  )
`;
await sql`
  INSERT INTO "AppConfig" ("key", "value", "updatedAt")
  VALUES ('api_seeded', 'true', NOW())
  ON CONFLICT ("key") DO UPDATE SET "value" = 'true', "updatedAt" = NOW()
`;

const after = await sql`SELECT COUNT(*) AS c FROM "Lead"`;

console.log('\n' + '━'.repeat(50));
console.log('✅ SEED COMPLETE');
console.log(`   Engine 1 (New Purchase):  ${e1Props.length} leads`);
console.log(`   Engine 2 (Renewal):        ${e2Props.length} leads`);
console.log(`   Total saved:               ${saved}`);
console.log(`   Grade A: ${grades.A}  B: ${grades.B}  C: ${grades.C}  D: ${grades.D}`);
console.log(`   DB total now:              ${after[0].c}`);
console.log('\n🔒 REAPI lock set — app will NOT call REAPI again.');
console.log('   To unlock: DELETE /api/admin/seed  or  DELETE FROM "AppConfig" WHERE key=\'api_seeded\'');
