/**
 * One-time seed script: calls REAPI and stores 100 NJ homeowner leads in Neon.
 * Run with: node scripts/seed-leads.mjs
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const envLocal = (() => { try { return readFileSync('.env.local', 'utf-8'); } catch { return ''; } })();

function getEnvVar(name, content) {
  const m = content.match(new RegExp(`${name}=([^\\n]+)`));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

const DATABASE_URL = getEnvVar('DATABASE_URL', env);
const REAPI_KEY = getEnvVar('NEXT_PUBLIC_REAL_ESTATE_API_KEY', envLocal) || process.env.NEXT_PUBLIC_REAL_ESTATE_API_KEY;
const REAPI_URL = 'https://api.realestateapi.com/v2/PropertySearch';

if (!DATABASE_URL) { console.error('❌ DATABASE_URL not found in .env'); process.exit(1); }
if (!REAPI_KEY) {
  console.error('❌ NEXT_PUBLIC_REAL_ESTATE_API_KEY not found in .env.local');
  process.exit(1);
}

// ─── Helper: Haversine distance ──────────────────────────────────────────────

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NJ_COAST = [
  { name: 'Sandy Hook',          lat: 40.4674, lng: -74.0094 },
  { name: 'Long Branch',         lat: 40.3029, lng: -73.9874 },
  { name: 'Asbury Park',         lat: 40.2232, lng: -74.0122 },
  { name: 'Point Pleasant Beach',lat: 40.0956, lng: -74.0440 },
  { name: 'Seaside Heights',     lat: 39.9457, lng: -74.0785 },
  { name: 'Island Beach',        lat: 39.8312, lng: -74.1010 },
  { name: 'Ship Bottom (LBI)',   lat: 39.6440, lng: -74.1877 },
  { name: 'Atlantic City',       lat: 39.3643, lng: -74.4229 },
  { name: 'Ocean City',          lat: 39.2776, lng: -74.5746 },
  { name: 'Cape May',            lat: 38.9351, lng: -74.9060 },
];

function calcCoast(lat, lng) {
  if (!lat || !lng) return null;
  let min = Infinity, nearest = NJ_COAST[0];
  for (const pt of NJ_COAST) {
    const d = haversineMiles(lat, lng, pt.lat, pt.lng);
    if (d < min) { min = d; nearest = pt; }
  }
  const distanceMiles = Math.round(min * 10) / 10;
  const exposure = distanceMiles < 0.5 ? 'extreme' : distanceMiles < 2 ? 'high' : distanceMiles < 5 ? 'moderate' : 'low';
  return { distanceMiles, exposure, nearestPoint: nearest.name };
}

// ─── Mortgage date filtering helpers ─────────────────────────────────────────

function offsetDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const ENGINE1_FROM = offsetDate(3);   // last 90 days
const ENGINE1_TO   = new Date().toISOString().slice(0, 10);
const ENGINE2_FROM = '2022-01-01';
const ENGINE2_TO   = '2025-12-31';

const OUT_OF_APPETITE_ZIPS = new Set([
  '07722','07724','07726','07728','07730','07731','07733','07746','07748','08701',
]);

// ─── Call REAPI ───────────────────────────────────────────────────────────────

async function fetchFromReapi(mortgageFrom, mortgageTo, size = 50) {
  const body = {
    ids_only: false,
    obfuscate: false,
    summary: false,
    state: 'NJ',
    flood_zone: false,
    vacant: false,
    pre_foreclosure: false,
    foreclosure: false,
    reo: false,
    first_mortgage_recording_date_min: mortgageFrom,
    first_mortgage_recording_date_max: mortgageTo,
    size,
  };
  console.log(`  Calling REAPI: mortgageDate ${mortgageFrom} → ${mortgageTo}, size=${size}`);
  const res = await fetch(REAPI_URL, {
    method: 'POST',
    headers: { 'x-api-key': REAPI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data || data.results || data.properties || [];
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

const sql = neon(DATABASE_URL);

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

function getEngine(p) {
  const d = p.recordingDate || p.lastSaleDate;
  if (!d) return null;
  const dt = new Date(d);
  const e1From = new Date(ENGINE1_FROM), e1To = new Date(ENGINE1_TO);
  const e2From = new Date(ENGINE2_FROM), e2To = new Date(ENGINE2_TO);
  if (dt >= e1From && dt <= e1To) return 1;
  if (dt >= e2From && dt <= e2To) return 2;
  return null;
}

async function upsert(property) {
  const pid = property.propertyId || property.id;
  if (!pid) return 'skip';

  const zip = (property.address?.zip || '').trim().slice(0, 5);
  if (OUT_OF_APPETITE_ZIPS.has(zip)) return 'skip';

  const coast = calcCoast(
    property.latitude ? parseFloat(property.latitude) : null,
    property.longitude ? parseFloat(property.longitude) : null,
  );

  const now = new Date().toISOString();
  const engine = getEngine(property);
  const lastSaleAmountNum = property.lastSaleAmount ? parseFloat(String(property.lastSaleAmount).replace(/[^0-9.]/g, '')) : null;

  // Check existing
  const existing = await sql`SELECT "id", "owner1LastName" FROM "Lead" WHERE "propertyId" = ${pid}`;

  const payload = {
    id: pid,
    propertyId: pid,
    addressStreet: property.address?.street || '',
    addressCity: property.address?.city || '',
    addressState: property.address?.state || 'NJ',
    addressZip: property.address?.zip || '',
    addressCounty: property.address?.county || null,
    addressFull: property.address?.address || null,
    propertyType: property.propertyType || null,
    propertyUse: property.propertyUse || null,
    landUse: property.landUse || null,
    yearBuilt: property.yearBuilt ? parseInt(property.yearBuilt) : null,
    squareFeet: property.squareFeet ? parseInt(property.squareFeet) : null,
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
    estimatedValue: property.estimatedValue ? parseFloat(property.estimatedValue) : null,
    assessedValue: property.assessedValue ? parseFloat(property.assessedValue) : null,
    lastSaleAmount: lastSaleAmountNum,
    lastSaleDate: property.lastSaleDate || null,
    estimatedEquity: property.estimatedEquity ? parseFloat(property.estimatedEquity) : null,
    openMortgageBalance: property.openMortgageBalance ? parseFloat(property.openMortgageBalance) : null,
    lenderName: property.lenderName || null,
    mortgageType: property.mortgageType || null,
    owner1LastName: property.owner1LastName || null,
    owner1FirstName: property.owner1FirstName || null,
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
    latitude: property.latitude ? parseFloat(property.latitude) : null,
    longitude: property.longitude ? parseFloat(property.longitude) : null,
    fips: property.fips || null,
    apn: property.apn || null,
    recordingDate: property.recordingDate || null,
    engine,
    status: 'new',
    coastDistanceMiles: coast?.distanceMiles ?? null,
    coastExposure: coast?.exposure ?? null,
    rawData: JSON.stringify(slimRaw(property)),
    createdAt: now,
    updatedAt: now,
  };

  const keys = Object.keys(payload);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map(k => toSql(payload[k]));
  const setClause = keys
    .filter(k => k !== 'id' && k !== 'propertyId' && k !== 'createdAt')
    .map(k => `"${k}" = EXCLUDED."${k}"`)
    .join(', ');

  if (existing.length > 0) {
    const incomingOwner = (property.owner1LastName || '').toLowerCase();
    const existingOwner = (existing[0].owner1LastName || '').toLowerCase();
    if (incomingOwner && existingOwner && incomingOwner !== existingOwner) {
      // New owner event — insert new record
      const newId = `${pid}-${property.recordingDate || Date.now()}`;
      payload.id = newId;
      const newValues = keys.map(k => toSql(payload[k]));
      const insertSql = `INSERT INTO "Lead" (${cols}) VALUES (${placeholders}) ON CONFLICT ("id") DO NOTHING`;
      await sql.unsafe(insertSql, newValues);
      return 'created';
    }
  }

  const upsertSql = `INSERT INTO "Lead" (${cols}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${setClause}`;
  await sql.unsafe(upsertSql, values);
  return existing.length > 0 ? 'updated' : 'created';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('🌱 Seeding NJ homeowner leads from REAPI...');

let created = 0, updated = 0, skipped = 0;

// Engine 1: new purchases (last 90 days)
console.log('\n📋 Engine 1 — New Purchases (last 90 days)...');
try {
  const e1 = await fetchFromReapi(ENGINE1_FROM, ENGINE1_TO, 50);
  console.log(`  Got ${e1.length} records`);
  for (const p of e1) {
    const r = await upsert(p);
    if (r === 'created') created++;
    else if (r === 'updated') updated++;
    else skipped++;
  }
} catch (err) {
  console.error('  Engine 1 error:', err.message);
}

// Engine 2: renewals (2022-2025)
console.log('\n📋 Engine 2 — Renewals (2022-2025)...');
try {
  const e2 = await fetchFromReapi(ENGINE2_FROM, ENGINE2_TO, 50);
  console.log(`  Got ${e2.length} records`);
  for (const p of e2) {
    const r = await upsert(p);
    if (r === 'created') created++;
    else if (r === 'updated') updated++;
    else skipped++;
  }
} catch (err) {
  console.error('  Engine 2 error:', err.message);
}

const total = await sql`SELECT COUNT(*) AS c FROM "Lead"`;
console.log(`\n✅ Seed complete: ${created} created, ${updated} updated, ${skipped} skipped`);
console.log(`   DB now has ${total[0].c} total leads`);
