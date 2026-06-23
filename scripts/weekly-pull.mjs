/**
 * Weekly REAPI pull — Frank Jun-2026. Standalone runner (bypasses auth middleware,
 * mirrors scripts/seed-from-reapi.mjs). Credit-efficient + de-duplicated.
 *
 *   Phase A  ids_only scan ............ FREE — discover candidate property IDs
 *   de-dup   diff vs stored IDs ....... records we already have cost nothing
 *   Phase B  full pull of NEW ids ..... CREDITS — only brand-new properties
 *   resurface existing renewals ....... FREE — refresh anniversary/x-date
 *
 * Runs Frank's EXACT windows (not the rolling computePullWindows):
 *   New biz  origination 2026-03-22 → 03-27   (effective ~6/22–6/27/26)
 *   Renewal  origination 8/22 → 8/29 for 2022, 2023, 2024, 2025
 *
 * Does NOT clear the DB and does NOT touch the api_seeded lock — purely additive.
 *
 * Usage:  node scripts/weekly-pull.mjs            (REAL pull — spends credits)
 *         node scripts/weekly-pull.mjs --dry-run  (FREE — Phase A only)
 */

import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const DRY_RUN   = process.argv.includes('--dry-run');
const FIX_DATES = process.argv.includes('--fix-dates'); // free: re-assign window dates only, no pull

// ─── Config ─────────────────────────────────────────────────────────────────
function readEnv(f) { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }
function getVar(key, content) {
  const m = content.match(new RegExp(`${key}=([^\\n]+)`));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}
const DATABASE_URL = getVar('DATABASE_URL', readEnv('.env')) || getVar('DATABASE_URL', readEnv('.env.local'));
const REAPI_KEY    = getVar('NEXT_PUBLIC_REAL_ESTATE_API_KEY', readEnv('.env.local'));
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not found'); process.exit(1); }
if (!REAPI_KEY)    { console.error('❌ NEXT_PUBLIC_REAL_ESTATE_API_KEY not in .env.local'); process.exit(1); }

const REAPI_BASE = 'https://api.realestateapi.com/v2';
const sql  = neon(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL });

const TARGET_ZIPS = ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'];
const BASE_FILTERS = {
  state: 'NJ', zip: TARGET_ZIPS,
  flood_zone: false, vacant: false, pre_foreclosure: false, foreclosure: false, reo: false,
};
const FULL_PULL_BATCH = 100;

// ─── Auto-rolling windows (computed from the run date — no edits needed) ───────
// Mirrors src/services/pipeline.service.ts → computePullWindows. The window
// defines the policy effective date: every lead is filtered to a first-mortgage
// origination in [min,max], so they all renew on the upcoming anniversary of that
// window (the summary API does not expose the per-lead mortgage date, and the deed
// `recordingDate` is a different/later date).
//   New biz (90-day lead) : origination = this-week − 90;  eff = this week
//   Renewal (60-day lead) : origination = anniversary month/day in prior years
//                           2022–2025;  eff = this-week + 60;  x-date = this week
const WINDOW_DAYS = 7;
const NEW_BIZ_LEAD_DAYS = 90;
const RENEWAL_LEAD_DAYS = 60;
const RENEWAL_YEARS_BACK = [1, 2, 3, 4];

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function computeWindows(runDate) {
  const start = new Date(ymd(runDate));            // normalize to UTC midnight
  const end = addDays(start, WINDOW_DAYS - 1);
  const out = [{
    kind: 'new_biz', label: 'New biz',
    min: ymd(addDays(start, -NEW_BIZ_LEAD_DAYS)),
    max: ymd(addDays(end, -NEW_BIZ_LEAD_DAYS)),
    eff: ymd(start), xdate: null,
  }];
  const annivStart = addDays(start, RENEWAL_LEAD_DAYS);
  const annivEnd = addDays(end, RENEWAL_LEAD_DAYS);
  const effYear = annivStart.getFullYear();
  for (const back of RENEWAL_YEARS_BACK) {
    const y = effYear - back;
    const mn = new Date(annivStart); mn.setFullYear(y);
    const mx = new Date(annivEnd); mx.setFullYear(y);
    out.push({
      kind: 'renewal', label: `Renewal ${y}`,
      min: ymd(mn), max: ymd(mx),
      eff: ymd(annivStart), xdate: ymd(start),
    });
  }
  return out;
}

// Run date: --date=YYYY-MM-DD to reproduce a specific week, else today.
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const RUN_DATE = dateArg ? new Date(dateArg.slice(7)) : new Date();
const WINDOWS = computeWindows(RUN_DATE);

// ─── REAPI ────────────────────────────────────────────────────────────────────
async function reapi(body) {
  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': REAPI_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REAPI ${res.status}: ${await res.text()}`);
  return res.json();
}
async function scanIds(w) { // FREE
  const d = await reapi({ ids_only: true, size: 10000, ...BASE_FILTERS,
    first_mortgage_recording_date_min: w.min, first_mortgage_recording_date_max: w.max });
  return (Array.isArray(d.data) ? d.data : []).map((x) => String(x?.id ?? x));
}
async function fetchFull(ids) { // CREDITS
  const out = [];
  for (let i = 0; i < ids.length; i += FULL_PULL_BATCH) {
    const chunk = ids.slice(i, i + FULL_PULL_BATCH);
    const d = await reapi({ ids_only: false, size: chunk.length, ids: chunk });
    if (Array.isArray(d.data)) out.push(...d.data);
  }
  return out;
}

// ─── Enrichment (inline — same calcs as seed-from-reapi.mjs) ───────────────────
const COAST_PTS = [
  { lat: 40.4674, lng: -74.0094 }, { lat: 40.3029, lng: -73.9874 }, { lat: 40.2232, lng: -74.0122 },
  { lat: 40.0956, lng: -74.0440 }, { lat: 39.9457, lng: -74.0785 }, { lat: 39.8312, lng: -74.1010 },
  { lat: 39.6440, lng: -74.1877 }, { lat: 39.3643, lng: -74.4229 }, { lat: 39.2776, lng: -74.5746 },
  { lat: 38.9351, lng: -74.9060 },
];
function haversine(a1, o1, a2, o2) {
  const R = 3958.8, dLat = ((a2-a1)*Math.PI)/180, dLng = ((o2-o1)*Math.PI)/180;
  const x = Math.sin(dLat/2)**2 + Math.cos(a1*Math.PI/180)*Math.cos(a2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function calcCoast(lat, lng) {
  if (!lat || !lng) return { dist: null, exposure: null };
  let min = Infinity;
  for (const p of COAST_PTS) { const d = haversine(lat, lng, p.lat, p.lng); if (d < min) min = d; }
  const dist = Math.round(min*10)/10;
  return { dist, exposure: dist < 0.5 ? 'extreme' : dist < 2 ? 'high' : dist < 5 ? 'moderate' : 'low' };
}
function checkCarriers(yearBuilt, estimatedValue, pool2) {
  const roofAge = 2026 - (yearBuilt || 2000), val = estimatedValue || 0;
  let tStatus = 'eligible'; const tNotes = [];
  if (roofAge > 20) { tStatus = 'review'; tNotes.push(`Roof age ${roofAge} yrs — inspection may be required`); }
  if (val > 1500000) { tStatus = tStatus === 'eligible' ? 'review' : tStatus; tNotes.push('High-value home — HNW review required'); }
  if (pool2) tNotes.push('Pool present — liability endorsement required');
  let pStatus = 'eligible'; const pNotes = [];
  if (roofAge > 25) { pStatus = 'ineligible'; pNotes.push(`Roof age ${roofAge} yrs exceeds Plymouth Rock limit`); }
  if (val > 2000000) { pStatus = 'ineligible'; pNotes.push('Value exceeds Plymouth Rock maximum ($2M)'); }
  return { tStatus, tNotes, pStatus, pNotes, passesAny: tStatus !== 'ineligible' || pStatus !== 'ineligible' };
}
function calcPricing(estimatedValue, squareFeet, yearBuilt, hasPool, coastExposure) {
  const val = estimatedValue || 300000, sqft = squareFeet || 1800, roofAge = 2026 - (yearBuilt || 2000);
  let base = val*0.0035;
  if (roofAge > 15) base *= 1.15; if (roofAge > 20) base *= 1.20; if (sqft > 3000) base *= 1.10;
  if (hasPool) base *= 1.05;
  if (coastExposure === 'extreme') base *= 1.35; else if (coastExposure === 'high') base *= 1.20; else if (coastExposure === 'moderate') base *= 1.08;
  const expected = Math.round(base/50)*50;
  return { low: Math.round(expected*0.85/50)*50, expected, high: Math.round(expected*1.20/50)*50, confidence: Math.max(30, 85 - (roofAge > 20 ? 10 : 0)) };
}
function calcGrade(lead, passesAny) {
  if (!passesAny) return 'D';
  const missing = [lead.owner1LastName, lead.addressStreet, lead.addressZip, lead.estimatedValue, lead.yearBuilt, lead.squareFeet].filter((f) => !f).length;
  return missing === 0 ? 'A' : missing === 1 ? 'B' : 'C';
}
function slimRaw(p) {
  const { salesHistory, taxHistory, priorMortgages, currentMortgages, ownerHistory, liens, ...rest } = p ?? {};
  return { ...rest, currentMortgage: Array.isArray(currentMortgages) ? (currentMortgages[0] ?? null) : null };
}
function toSql(v) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

// ─── Save (additive upsert; sets engine + dates by window kind) ────────────────
async function saveProperty(property, w) {
  const pid = property.propertyId || property.id;
  if (!pid) return null;
  const lat = property.latitude ? parseFloat(property.latitude) : null;
  const lng = property.longitude ? parseFloat(property.longitude) : null;
  const coast = calcCoast(lat, lng);
  const yearBuilt = property.yearBuilt ? parseInt(property.yearBuilt) : null;
  const estimatedValue = property.estimatedValue ? parseFloat(property.estimatedValue) : null;
  const squareFeet = property.squareFeet ? parseInt(property.squareFeet) : null;
  const carriers = checkCarriers(yearBuilt, estimatedValue, property.pool);
  const pricing = calcPricing(estimatedValue, squareFeet, yearBuilt, property.pool, coast.exposure);

  const recordingDate = property.recordingDate || property.lastSaleDate || null; // deed date (real data)
  const engine = w.kind === 'renewal' ? 2 : 1;
  // Effective / x-date come from the WINDOW (see WINDOWS note), not the deed date.
  const renewalTargetDate = w.xdate ? new Date(w.xdate) : null;
  const effDate = w.eff ? new Date(w.eff) : null;

  const flat = {
    id: pid, propertyId: pid,
    addressStreet: property.address?.street || property.address?.address || '',
    addressCity: property.address?.city || '', addressState: property.address?.state || 'NJ',
    addressZip: property.address?.zip || '', addressCounty: property.address?.county || null,
    addressFull: property.address?.address || null,
    mailStreet: property.mailAddress?.street || null, mailCity: property.mailAddress?.city || null,
    mailState: property.mailAddress?.state || null, mailZip: property.mailAddress?.zip || null,
    propertyType: property.propertyType || null, propertyUse: property.propertyUse || null,
    landUse: property.landUse || null, yearBuilt, squareFeet,
    lotSquareFeet: property.lotSquareFeet ? parseInt(property.lotSquareFeet) : null,
    bedrooms: property.bedrooms ? parseInt(property.bedrooms) : null,
    bathrooms: property.bathrooms ? parseFloat(property.bathrooms) : null,
    stories: property.stories ? parseFloat(property.stories) : null,
    garage: property.garage ?? null, pool: property.pool ?? null, deck: property.deck ?? null,
    patio: property.patio ?? null, basement: property.basement ?? null,
    airConditioning: property.airConditioningAvailable ?? null,
    estimatedValue, assessedValue: property.assessedValue ? parseFloat(property.assessedValue) : null,
    lastSaleAmount: property.lastSaleAmount ? parseFloat(String(property.lastSaleAmount).replace(/[^0-9.]/g, '')) : null,
    lastSaleDate: property.lastSaleDate || null,
    estimatedEquity: property.estimatedEquity ? parseFloat(property.estimatedEquity) : null,
    openMortgageBalance: property.openMortgageBalance ? parseFloat(property.openMortgageBalance) : null,
    lenderName: property.lenderName || null, mortgageType: property.mortgageType || null,
    owner1LastName: property.owner1LastName || null, owner1FirstName: property.owner1FirstName || null,
    companyName: property.companyName || null, ownerOccupied: property.ownerOccupied ?? null,
    corporateOwned: property.corporateOwned ?? null, absenteeOwner: property.absenteeOwner ?? null,
    investorBuyer: property.investorBuyer ?? null, vacant: property.vacant ?? null,
    preForeclosure: property.preForeclosure ?? null, foreclosure: property.foreclosure ?? null,
    reo: property.reo ?? null, floodZone: property.floodZone ?? null,
    floodZoneType: property.floodZoneType || null,
    latitude: lat, longitude: lng, fips: property.fips || null, apn: property.apn || null,
    recordingDate, engine,
    renewalTargetDate: renewalTargetDate ? renewalTargetDate.toISOString() : null,
    effectiveDate: effDate ? effDate.toISOString().slice(0, 10) : null,
    status: 'new', grade: null,
    travelersEligible: carriers.tStatus, travelersNotes: JSON.stringify(carriers.tNotes),
    plymouthEligible: carriers.pStatus, plymouthNotes: JSON.stringify(carriers.pNotes),
    lowPremium: pricing.low, expectedPremium: pricing.expected, highPremium: pricing.high,
    pricingConfidence: pricing.confidence,
    coastDistanceMiles: coast.dist, coastExposure: coast.exposure,
    rawData: JSON.stringify(slimRaw(property)),
  };
  flat.grade = calcGrade(flat, carriers.passesAny);

  const now = new Date().toISOString();
  const keys = Object.keys(flat);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i+1}`).join(', ');
  const setClauses = keys.filter((k) => k !== 'id' && k !== 'propertyId')
    .map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ');
  await pool.query(
    `INSERT INTO "Lead" (${cols}, "createdAt", "updatedAt")
     VALUES (${placeholders}, $${keys.length+1}, $${keys.length+2})
     ON CONFLICT ("id") DO UPDATE SET ${setClauses}, "updatedAt" = EXCLUDED."updatedAt"`,
    [...keys.map((k) => toSql(flat[k])), now, now],
  );
  return flat.grade;
}

// FREE — set/refresh window-based effective + x-date for matched stored leads
async function applyWindowDates(ids, w) {
  if (!ids.length) return 0;
  const res = await pool.query(
    `UPDATE "Lead"
       SET "engine" = $1,
           "effectiveDate" = $2,
           "renewalTargetDate" = $3,
           "updatedAt" = NOW()
     WHERE "propertyId" = ANY($4)`,
    [w.kind === 'renewal' ? 2 : 1, w.eff || null, w.xdate ? new Date(w.xdate).toISOString() : null, ids],
  );
  return res.rowCount ?? 0;
}

async function existingIds(ids) {
  if (!ids.length) return new Set();
  const { rows } = await pool.query(`SELECT "propertyId" FROM "Lead" WHERE "propertyId" = ANY($1)`, [ids]);
  return new Set(rows.map((r) => String(r.propertyId)));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const MODE = FIX_DATES ? '(FIX-DATES — free, re-assign window dates only)'
           : DRY_RUN   ? '(DRY RUN — free, no credits)'
           :             '(REAL — spends credits)';
console.log(`\n🔄 BIA Weekly Pull  ${MODE}`);
console.log('━'.repeat(72));

let totMatched = 0, totHave = 0, totNew = 0, totDated = 0;
const grades = { A: 0, B: 0, C: 0, D: 0 };

for (const w of WINDOWS) {
  const ids = await scanIds(w);                       // FREE
  const have = await existingIds(ids);
  const newIds = ids.filter((id) => !have.has(id));
  const existIds = ids.filter((id) => have.has(id));
  totMatched += ids.length; totHave += existIds.length;

  let pulled = 0, dated = 0;
  if (FIX_DATES) {
    dated = await applyWindowDates(ids.filter((id) => have.has(id)), w); // FREE — fix stored leads
  } else if (!DRY_RUN) {
    if (newIds.length) {
      const props = await fetchFull(newIds);          // CREDITS — new only
      for (const p of props) { const g = await saveProperty(p, w); if (g) { grades[g]++; pulled++; } }
    }
    // window dates for everything matched (new + already-stored), all FREE
    dated = await applyWindowDates(ids.filter((id) => have.has(id)), w);
  } else {
    pulled = newIds.length; // would-be credits
  }
  totNew += pulled; totDated += dated;

  const action = FIX_DATES ? `dated ${String(dated).padStart(4)}`
               : DRY_RUN   ? `would-pull ${String(pulled).padStart(4)}`
               :             `pulled ${String(pulled).padStart(4)}  dated ${String(dated).padStart(3)}`;
  console.log(`  ${w.label.padEnd(14)} ${w.min}→${w.max}  matched ${String(ids.length).padStart(4)}  have ${String(existIds.length).padStart(3)}  ${action}`);
}

console.log('━'.repeat(72));
console.log(`  matched ${totMatched}   already-have ${totHave}   ${DRY_RUN ? 'WOULD-SPEND' : FIX_DATES ? 'DATES-FIXED' : 'CREDITS SPENT'} ${FIX_DATES ? totDated : totNew}`);
if (!DRY_RUN && !FIX_DATES) console.log(`  new lead grades →  A:${grades.A}  B:${grades.B}  C:${grades.C}  D:${grades.D}`);
console.log(FIX_DATES ? '\n✅ Window dates re-applied (free).' : DRY_RUN ? '\n  (dry run — nothing written, no credits used)' : '\n✅ Pull complete.');
await pool.end();
