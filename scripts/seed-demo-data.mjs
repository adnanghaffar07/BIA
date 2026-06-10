/**
 * Seed demo data: 30 realistic NJ homeowner leads with full enrichment.
 * Covers both Engine 1 (New Purchase) and Engine 2 (Renewal/Win-Back).
 * Run: node scripts/seed-demo-data.mjs
 */

import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
if (!match) { console.error('❌ DATABASE_URL not found'); process.exit(1); }

const sql = neon(match[1]);
const pool = new Pool({ connectionString: match[1] });

// ─── Carrier eligibility ─────────────────────────────────────────────────────

function checkCarriers(lead) {
  const year = lead.yearBuilt || 2000;
  const roofAge = 2026 - year;
  const val = lead.estimatedValue || 0;

  let tStatus = 'eligible';
  const tNotes = [];
  if (roofAge > 20) { tStatus = 'review'; tNotes.push(`Roof age ${roofAge} yrs — may require inspection`); }
  if (val > 1500000) { tStatus = 'review'; tNotes.push('Home value exceeds standard limit; requires HNW review'); }
  if (lead.pool) tNotes.push('Pool present — liability endorsement required');

  let pStatus = 'eligible';
  const pNotes = [];
  if (roofAge > 25) { pStatus = 'ineligible'; pNotes.push(`Roof age ${roofAge} yrs exceeds Plymouth Rock limit (25 yr)`); }
  if (val > 2000000) { pStatus = 'ineligible'; pNotes.push('Value exceeds Plymouth Rock maximum ($2M)'); }

  const passesAny = tStatus !== 'ineligible' || pStatus !== 'ineligible';
  return { tStatus, tNotes, pStatus, pNotes, passesAny };
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

function calcPricing(lead) {
  const val = lead.estimatedValue || 300000;
  const sqft = lead.squareFeet || 1800;
  const year = lead.yearBuilt || 2000;
  const roofAge = 2026 - year;
  const zip = (lead.addressZip || '').slice(0, 5);

  let base = val * 0.0035;
  if (roofAge > 15) base *= 1.15;
  if (roofAge > 20) base *= 1.20;
  if (sqft > 3000) base *= 1.10;
  if (lead.pool) base *= 1.05;
  if (lead.coastExposure === 'extreme') base *= 1.35;
  else if (lead.coastExposure === 'high') base *= 1.20;
  else if (lead.coastExposure === 'moderate') base *= 1.08;

  const expected = Math.round(base / 50) * 50;
  const low = Math.round(expected * 0.85 / 50) * 50;
  const high = Math.round(expected * 1.20 / 50) * 50;

  const criticalFields = [
    lead.owner1LastName, lead.addressStreet, lead.addressZip, lead.estimatedValue,
    lead.yearBuilt, lead.squareFeet
  ];
  const missingCount = criticalFields.filter(f => !f).length;
  const confidence = Math.max(20, 90 - (missingCount * 15) - (roofAge > 20 ? 10 : 0));

  return { low, expected, high, confidence };
}

// ─── Coast distance ───────────────────────────────────────────────────────────

const COAST_PTS = [
  { name: 'Sandy Hook',           lat: 40.4674, lng: -74.0094 },
  { name: 'Long Branch',          lat: 40.3029, lng: -73.9874 },
  { name: 'Asbury Park',          lat: 40.2232, lng: -74.0122 },
  { name: 'Point Pleasant Beach', lat: 40.0956, lng: -74.0440 },
  { name: 'Seaside Heights',      lat: 39.9457, lng: -74.0785 },
  { name: 'Atlantic City',        lat: 39.3643, lng: -74.4229 },
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
  if (!lat || !lng) return { dist: null, exposure: null, nearestPoint: null };
  let min = Infinity, nearest = COAST_PTS[0];
  for (const p of COAST_PTS) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (d < min) { min = d; nearest = p; }
  }
  const dist = Math.round(min * 10) / 10;
  const exposure = dist < 0.5 ? 'extreme' : dist < 2 ? 'high' : dist < 5 ? 'moderate' : 'low';
  return { dist, exposure, nearestPoint: nearest.name };
}

// ─── Grading ──────────────────────────────────────────────────────────────────

function calcGrade(lead, passesAny) {
  if (!passesAny) return 'D';
  const critical = [
    lead.owner1LastName, lead.addressStreet, lead.addressZip,
    lead.estimatedValue, lead.yearBuilt, lead.squareFeet
  ];
  const missing = critical.filter(f => !f).length;
  if (missing === 0) return 'A';
  if (missing === 1) return 'B';
  return 'C';
}

// ─── Demo lead definitions ────────────────────────────────────────────────────

const TODAY = new Date();
const daysAgo = (d) => { const dt = new Date(TODAY); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0,10); };

const DEMO_LEADS = [
  // Engine 1 — New Purchases
  { propertyId:'NJ-E1-001', addressStreet:'14 Oak Ridge Dr',   addressCity:'Morristown',       addressState:'NJ', addressZip:'07960', owner1FirstName:'Robert',   owner1LastName:'Thompson', yearBuilt:2005, squareFeet:2800, estimatedValue:620000, bedrooms:4, bathrooms:2.5, pool:false, garage:true, lat:40.7968, lng:-74.4815, recordingDate:daysAgo(14),  engine:1 },
  { propertyId:'NJ-E1-002', addressStreet:'88 Maple Ave',      addressCity:'Summit',           addressState:'NJ', addressZip:'07901', owner1FirstName:'Linda',    owner1LastName:'Petersen',  yearBuilt:1998, squareFeet:3200, estimatedValue:890000, bedrooms:5, bathrooms:3.0, pool:true,  garage:true, lat:40.7157, lng:-74.3593, recordingDate:daysAgo(22),  engine:1 },
  { propertyId:'NJ-E1-003', addressStreet:'5 Colonial Blvd',   addressCity:'Westfield',        addressState:'NJ', addressZip:'07090', owner1FirstName:'James',    owner1LastName:'Whitfield', yearBuilt:2012, squareFeet:2400, estimatedValue:740000, bedrooms:4, bathrooms:2.0, pool:false, garage:true, lat:40.6598, lng:-74.3471, recordingDate:daysAgo(35),  engine:1 },
  { propertyId:'NJ-E1-004', addressStreet:'301 Hillcrest Rd',  addressCity:'Chatham',          addressState:'NJ', addressZip:'07928', owner1FirstName:'Maria',    owner1LastName:'Gonzalez',  yearBuilt:2001, squareFeet:2100, estimatedValue:580000, bedrooms:3, bathrooms:2.0, pool:false, garage:true, lat:40.7418, lng:-74.3829, recordingDate:daysAgo(41),  engine:1 },
  { propertyId:'NJ-E1-005', addressStreet:'27 River Bend Ct',  addressCity:'Bernardsville',    addressState:'NJ', addressZip:'07924', owner1FirstName:'Daniel',   owner1LastName:'Murphy',    yearBuilt:2018, squareFeet:3600, estimatedValue:1200000,bedrooms:5, bathrooms:3.5, pool:true,  garage:true, lat:40.7168, lng:-74.5673, recordingDate:daysAgo(12),  engine:1 },
  { propertyId:'NJ-E1-006', addressStreet:'63 Elm Court',      addressCity:'Madison',          addressState:'NJ', addressZip:'07940', owner1FirstName:'Patricia', owner1LastName:'Chen',      yearBuilt:1995, squareFeet:1950, estimatedValue:485000, bedrooms:3, bathrooms:1.5, pool:false, garage:false,lat:40.7598, lng:-74.4177, recordingDate:daysAgo(55),  engine:1 },
  { propertyId:'NJ-E1-007', addressStreet:'112 Sunset Dr',     addressCity:'Parsippany',       addressState:'NJ', addressZip:'07054', owner1FirstName:'Kevin',    owner1LastName:'Williams',  yearBuilt:2008, squareFeet:2600, estimatedValue:530000, bedrooms:4, bathrooms:2.5, pool:false, garage:true, lat:40.8579, lng:-74.4268, recordingDate:daysAgo(67),  engine:1 },
  { propertyId:'NJ-E1-008', addressStreet:'44 Brook Path',     addressCity:'Short Hills',      addressState:'NJ', addressZip:'07078', owner1FirstName:'Sarah',    owner1LastName:'Harrison',  yearBuilt:2015, squareFeet:4100, estimatedValue:1450000,bedrooms:5, bathrooms:4.0, pool:true,  garage:true, lat:40.7326, lng:-74.3254, recordingDate:daysAgo(28),  engine:1 },
  { propertyId:'NJ-E1-009', addressStreet:'9 Birchwood Ln',    addressCity:'Bedminster',       addressState:'NJ', addressZip:'07921', owner1FirstName:'Michael',  owner1LastName:'Kaplan',    yearBuilt:2022, squareFeet:3900, estimatedValue:1100000,bedrooms:4, bathrooms:3.5, pool:true,  garage:true, lat:40.6551, lng:-74.6532, recordingDate:daysAgo(8),   engine:1 },
  { propertyId:'NJ-E1-010', addressStreet:'76 Meadowbrook Rd', addressCity:'Warren',           addressState:'NJ', addressZip:'07059', owner1FirstName:'Jennifer', owner1LastName:'Foster',    yearBuilt:2000, squareFeet:2250, estimatedValue:565000, bedrooms:3, bathrooms:2.0, pool:false, garage:true, lat:40.6854, lng:-74.4960, recordingDate:daysAgo(48),  engine:1 },

  // Engine 1 — Near coast (high/extreme exposure)
  { propertyId:'NJ-E1-011', addressStreet:'18 Ocean Ave',      addressCity:'Spring Lake',      addressState:'NJ', addressZip:'07762', owner1FirstName:'Thomas',   owner1LastName:'Bradley',   yearBuilt:2003, squareFeet:2700, estimatedValue:780000, bedrooms:4, bathrooms:2.5, pool:false, garage:true, lat:40.1551, lng:-74.0303, recordingDate:daysAgo(30),  engine:1 },
  { propertyId:'NJ-E1-012', addressStreet:'225 Beachfront Blvd',addressCity:'Point Pleasant',  addressState:'NJ', addressZip:'08742', owner1FirstName:'Nancy',    owner1LastName:'Wilson',    yearBuilt:1988, squareFeet:1850, estimatedValue:445000, bedrooms:3, bathrooms:2.0, pool:false, garage:false,lat:40.0879, lng:-74.0413, recordingDate:daysAgo(19),  engine:1 },

  // Engine 2 — Renewal / Win-Back
  { propertyId:'NJ-E2-001', addressStreet:'51 Highland Ave',   addressCity:'Montclair',        addressState:'NJ', addressZip:'07042', owner1FirstName:'Andrew',   owner1LastName:'Strickland', yearBuilt:1992, squareFeet:2100, estimatedValue:650000, bedrooms:4, bathrooms:2.0, pool:false, garage:true, lat:40.8254, lng:-74.2093, recordingDate:'2023-03-15', engine:2 },
  { propertyId:'NJ-E2-002', addressStreet:'7 Heritage Ct',     addressCity:'Livingston',       addressState:'NJ', addressZip:'07039', owner1FirstName:'Cynthia',  owner1LastName:'Zhao',      yearBuilt:2006, squareFeet:3100, estimatedValue:820000, bedrooms:4, bathrooms:3.0, pool:true,  garage:true, lat:40.7926, lng:-74.3160, recordingDate:'2022-09-22', engine:2 },
  { propertyId:'NJ-E2-003', addressStreet:'190 Prospect St',   addressCity:'Ridgewood',        addressState:'NJ', addressZip:'07450', owner1FirstName:'William',  owner1LastName:'McAllister', yearBuilt:2010, squareFeet:2900, estimatedValue:975000, bedrooms:4, bathrooms:3.0, pool:false, garage:true, lat:41.0132, lng:-74.1165, recordingDate:'2024-01-10', engine:2 },
  { propertyId:'NJ-E2-004', addressStreet:'33 Millburn Ave',   addressCity:'Millburn',         addressState:'NJ', addressZip:'07041', owner1FirstName:'Susan',    owner1LastName:'Park',      yearBuilt:1985, squareFeet:2600, estimatedValue:720000, bedrooms:4, bathrooms:2.5, pool:false, garage:true, lat:40.7262, lng:-74.2982, recordingDate:'2023-07-05', engine:2 },
  { propertyId:'NJ-E2-005', addressStreet:'42 Fairview Rd',    addressCity:'Tenafly',          addressState:'NJ', addressZip:'07670', owner1FirstName:'Richard',  owner1LastName:'Abramowitz', yearBuilt:2014, squareFeet:3400, estimatedValue:1050000,bedrooms:5, bathrooms:3.5, pool:false, garage:true, lat:40.9243, lng:-73.9582, recordingDate:'2022-11-18', engine:2 },
  { propertyId:'NJ-E2-006', addressStreet:'118 Oak Ln',        addressCity:'Ramsey',           addressState:'NJ', addressZip:'07446', owner1FirstName:'Karen',    owner1LastName:'Mitchell',  yearBuilt:2000, squareFeet:2300, estimatedValue:510000, bedrooms:3, bathrooms:2.0, pool:false, garage:true, lat:41.0573, lng:-74.1432, recordingDate:'2024-06-30', engine:2 },
  { propertyId:'NJ-E2-007', addressStreet:'65 Glenn Rd',       addressCity:'Denville',         addressState:'NJ', addressZip:'07834', owner1FirstName:'Charles',  owner1LastName:'Armstrong', yearBuilt:1997, squareFeet:1980, estimatedValue:430000, bedrooms:3, bathrooms:1.5, pool:false, garage:true, lat:40.8934, lng:-74.4804, recordingDate:'2023-04-12', engine:2 },
  { propertyId:'NJ-E2-008', addressStreet:'29 Willow Way',     addressCity:'Basking Ridge',    addressState:'NJ', addressZip:'07920', owner1FirstName:'Dorothy',  owner1LastName:'Huang',     yearBuilt:2016, squareFeet:3700, estimatedValue:950000, bedrooms:5, bathrooms:4.0, pool:true,  garage:true, lat:40.6968, lng:-74.5554, recordingDate:'2022-08-03', engine:2 },
  { propertyId:'NJ-E2-009', addressStreet:'84 Fernwood Dr',    addressCity:'Florham Park',     addressState:'NJ', addressZip:'07932', owner1FirstName:'Joseph',   owner1LastName:'Delgado',   yearBuilt:2009, squareFeet:2750, estimatedValue:670000, bedrooms:4, bathrooms:2.5, pool:false, garage:true, lat:40.7815, lng:-74.3907, recordingDate:'2025-02-14', engine:2 },
  { propertyId:'NJ-E2-010', addressStreet:'11 Summit Dr',      addressCity:'Harding Twp',      addressState:'NJ', addressZip:'07976', owner1FirstName:'Barbara',  owner1LastName:'Schofield', yearBuilt:2020, squareFeet:4800, estimatedValue:1850000,bedrooms:6, bathrooms:5.0, pool:true,  garage:true, lat:40.7418, lng:-74.4732, recordingDate:'2023-12-01', engine:2 },

  // Engine 2 — some with incomplete data (Grade B / C)
  { propertyId:'NJ-E2-011', addressStreet:'52 Toms River Rd',  addressCity:'Jackson',          addressState:'NJ', addressZip:'08527', owner1FirstName:'',         owner1LastName:'',          yearBuilt:1999, squareFeet:1900, estimatedValue:320000, bedrooms:3, bathrooms:2.0, pool:false, garage:true, lat:40.1001, lng:-74.3568, recordingDate:'2023-08-19', engine:2 },
  { propertyId:'NJ-E2-012', addressStreet:'340 Route 9',        addressCity:'Howell',           addressState:'NJ', addressZip:'07731', owner1FirstName:'Gary',     owner1LastName:'Novak',     yearBuilt:1978, squareFeet:null,estimatedValue:290000, bedrooms:3, bathrooms:1.0, pool:false, garage:false,lat:40.1840, lng:-74.2010, recordingDate:'2024-03-22', engine:2 },

  // Grade D leads (out-of-appetite ZIP)
  { propertyId:'NJ-D-001',  addressStreet:'5 Shore Blvd',       addressCity:'Keansburg',        addressState:'NJ', addressZip:'07734', owner1FirstName:'Frank',    owner1LastName:'Ross',      yearBuilt:1965, squareFeet:1100, estimatedValue:210000, bedrooms:3, bathrooms:1.0, pool:false, garage:false,lat:40.4423, lng:-74.1293, recordingDate:'2023-06-15', engine:2 },
  { propertyId:'NJ-D-002',  addressStreet:'17 Bay Ave',          addressCity:'Bayville',         addressState:'NJ', addressZip:'08721', owner1FirstName:'Donna',    owner1LastName:'Torres',    yearBuilt:1975, squareFeet:1250, estimatedValue:240000, bedrooms:3, bathrooms:1.5, pool:false, garage:true, lat:39.9076, lng:-74.1551, recordingDate:'2024-04-09', engine:2 },

  // Bound lead (for variance demo)
  { propertyId:'NJ-BND-001',addressStreet:'16 Ridgemont Pl',    addressCity:'Chatham',          addressState:'NJ', addressZip:'07928', owner1FirstName:'George',   owner1LastName:'Walton',    yearBuilt:2011, squareFeet:3000, estimatedValue:795000, bedrooms:4, bathrooms:3.0, pool:false, garage:true, lat:40.7418, lng:-74.3829, recordingDate:'2023-05-01', engine:2, status:'bound', boundPremium:2750, posCarrier:'Travelers', posQuoteNumber:'TRV-2026-44821', varianceNotes:'Roof was recently replaced in 2024, improved condition discount applied', varianceReason:'roof_age' },
];

// ─── Insert ───────────────────────────────────────────────────────────────────

async function insertLead(raw) {
  const coast = calcCoast(raw.lat, raw.lng);
  const lead = {
    ...raw,
    coastDistanceMiles: coast.dist,
    coastExposure: coast.exposure,
  };

  const carriers = checkCarriers(lead);
  const pricing = calcPricing(lead);
  const grade = calcGrade(lead, carriers.passesAny);

  const now = new Date().toISOString();

  const expectedPremium = pricing.expected;
  const boundPremium = raw.boundPremium ?? null;
  const varianceAmount = boundPremium && expectedPremium ? Math.round((boundPremium - expectedPremium) * 10) / 10 : null;

  // Build flat row
  const row = {
    id: raw.propertyId,
    propertyId: raw.propertyId,
    addressStreet: raw.addressStreet,
    addressCity: raw.addressCity,
    addressState: raw.addressState,
    addressZip: raw.addressZip,
    propertyType: 'Single Family Residential',
    propertyUse: 'Residential',
    landUse: 'Single Family Residential',
    yearBuilt: raw.yearBuilt,
    squareFeet: raw.squareFeet,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    pool: raw.pool,
    garage: raw.garage,
    estimatedValue: raw.estimatedValue,
    owner1FirstName: raw.owner1FirstName || null,
    owner1LastName: raw.owner1LastName || null,
    ownerOccupied: true,
    floodZone: false,
    vacant: false,
    latitude: raw.lat,
    longitude: raw.lng,
    recordingDate: raw.recordingDate,
    engine: raw.engine,
    status: raw.status || 'new',
    grade,
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
    boundPremium: raw.boundPremium ?? null,
    posCarrier: raw.posCarrier ?? null,
    posQuoteNumber: raw.posQuoteNumber ?? null,
    varianceNotes: raw.varianceNotes ?? null,
    varianceReason: raw.varianceReason ?? null,
    varianceAmount,
    rawData: JSON.stringify({ source: 'demo_seed', propertyId: raw.propertyId }),
    createdAt: now,
    updatedAt: now,
  };

  const keys = Object.keys(row);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const vals = keys.map(k => row[k]);
  const placeholders = keys.map((_, i) => `$${i+1}`).join(', ');
  const onConflict = keys
    .filter(k => k !== 'id' && k !== 'propertyId' && k !== 'createdAt')
    .map(k => `"${k}" = EXCLUDED."${k}"`)
    .join(', ');

  const q = `INSERT INTO "Lead" (${cols}) VALUES (${placeholders}) ON CONFLICT ("id") DO UPDATE SET ${onConflict}`;
  await pool.query(q, vals);

  console.log(`  ✓ ${raw.propertyId} | ${raw.addressStreet}, ${raw.addressCity} | Grade ${grade} | ${coast.exposure ?? 'no coords'} coastal | ${carriers.tStatus}/${carriers.pStatus}`);
}

console.log('🌱 Seeding demo leads...\n');
let count = 0;
for (const lead of DEMO_LEADS) {
  await insertLead(lead);
  count++;
}

const totals = await sql`
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE grade = 'A') AS "gradeA",
    COUNT(*) FILTER (WHERE grade = 'B') AS "gradeB",
    COUNT(*) FILTER (WHERE grade = 'C') AS "gradeC",
    COUNT(*) FILTER (WHERE grade = 'D') AS "gradeD",
    COUNT(*) FILTER (WHERE engine = 1)  AS engine1,
    COUNT(*) FILTER (WHERE engine = 2)  AS engine2
  FROM "Lead"
`;

console.log(`\n✅ Done! Seeded ${count} demo leads`);
console.log(`   DB now has: ${JSON.stringify(totals[0])}`);
