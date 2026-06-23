/**
 * FREE credit estimator — runs ids_only PropertySearch calls (which do NOT
 * consume credits) for this week's renewal + new-business windows, so we can
 * tell Frank how many credits a full pull would cost BEFORE spending any.
 *
 * Usage: node scripts/estimate-credits.mjs
 */

import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

function readEnv(file) { try { return readFileSync(file, 'utf-8'); } catch { return ''; } }
function getVar(key, content) {
  const m = content.match(new RegExp(`${key}=([^\\n]+)`));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}
const REAPI_KEY    = getVar('NEXT_PUBLIC_REAL_ESTATE_API_KEY', readEnv('.env.local'));
const DATABASE_URL = getVar('DATABASE_URL', readEnv('.env')) || getVar('DATABASE_URL', readEnv('.env.local'));
if (!REAPI_KEY) { console.error('❌ NEXT_PUBLIC_REAL_ESTATE_API_KEY not in .env.local'); process.exit(1); }
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

const REAPI_BASE  = 'https://api.realestateapi.com/v2';
const TARGET_ZIPS = ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'];

// ── This week's windows (Frank's numbers; today = 2026-06-23) ──────────────────
//  New biz : origination 90 days before this week's effective (6/22–6/27/26)
//  Renewal : origination = anniversary day (8/22–8/27) across prior years 2022–2025,
//            effective = 8/22–8/27/26 (pulled 60 days early)
// Frank's exact dates: new biz origination 3/22–3/27; renewal 8/22–8/29 (his "7 days") × 2022–2025
const WINDOWS = [
  { label: 'NEW BIZ  origination 2026-03-22 → 03-27', min: '2026-03-22', max: '2026-03-27' },
  { label: 'RENEWAL  origination 2022-08-22 → 08-29', min: '2022-08-22', max: '2022-08-29' },
  { label: 'RENEWAL  origination 2023-08-22 → 08-29', min: '2023-08-22', max: '2023-08-29' },
  { label: 'RENEWAL  origination 2024-08-22 → 08-29', min: '2024-08-22', max: '2024-08-29' },
  { label: 'RENEWAL  origination 2025-08-22 → 08-29', min: '2025-08-22', max: '2025-08-29' },
];

async function countWindow(w) {
  const res = await fetch(`${REAPI_BASE}/PropertySearch`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': REAPI_KEY },
    body: JSON.stringify({
      ids_only: true,            // ← FREE: returns IDs only, no credits charged
      obfuscate: false,
      summary: false,
      count: true,
      state: 'NJ',
      zip: TARGET_ZIPS,
      flood_zone: false,
      vacant: false,
      pre_foreclosure: false,
      foreclosure: false,
      reo: false,
      first_mortgage_recording_date_min: w.min,
      first_mortgage_recording_date_max: w.max,
    }),
  });
  if (!res.ok) throw new Error(`REAPI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const ids = (Array.isArray(data.data) ? data.data : []).map((x) => String(x?.id ?? x));
  const count = data.resultCount ?? data.recordCount ?? data.count ?? ids.length;
  return { count, ids };
}

/** How many of these propertyIds are already stored (→ free to re-use) */
async function alreadyHave(ids) {
  if (!sql || ids.length === 0) return 0;
  const rows = await sql`SELECT COUNT(DISTINCT "propertyId")::int AS c
                         FROM "Lead" WHERE "propertyId" = ANY(${ids})`;
  return rows[0]?.c ?? 0;
}

console.log('\n💳 BIA Credit Estimate — FREE ids_only scan (no credits spent)');
console.log('━'.repeat(72));
console.log('   gross  have   NEW   window');

let gNew = 0, gRen = 0, nNew = 0, nRen = 0;
for (const w of WINDOWS) {
  try {
    const { count, ids } = await countWindow(w);
    const have = await alreadyHave(ids);
    const fresh = Math.max(count - have, 0);   // full-data IDs cap at 1000; gross uses resultCount
    console.log(`   ${String(count).padStart(5)} ${String(have).padStart(5)} ${String(fresh).padStart(5)}   ${w.label}`);
    if (w.label.startsWith('NEW')) { gNew += count; nNew += fresh; } else { gRen += count; nRen += fresh; }
  } catch (err) {
    console.log(`       ?     ?     ?   ${w.label}  — ${err.message}`);
  }
}

console.log('━'.repeat(72));
console.log(`  NEW BIZ  (7-day slice)           :  gross ${gNew}   net-new ${nNew}`);
console.log(`  RENEWAL  (7-day × 4 yrs 2022–25) :  gross ${gRen}   net-new ${nRen}`);
console.log(`  TOTAL this week                  :  gross ${gNew + gRen}   net-new ${nNew + nRen}  ← credits actually spent`);
console.log(`\n  ${sql ? '"have" = already in our DB → re-used for $0.' : '⚠️  No DATABASE_URL — net-new not computed; gross shown only.'}`);
