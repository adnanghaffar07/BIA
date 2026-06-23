/**
 * FEMA flood backfill — FREE (public FEMA NFHL ArcGIS API, no key, no credits).
 * Stamps authoritative flood zone on every lead with coordinates and applies
 * Frank's flood→grade cap (SFHA → D, shaded-X 0.2% → C). Never clobbers a manual
 * flood override or a manual grade override.
 *
 * Usage:  node scripts/backfill-fema.mjs
 */
import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

function readEnv(f) { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }
function getVar(k, c) { const m = c.match(new RegExp(`${k}=([^\\n]+)`)); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; }
const DATABASE_URL = getVar('DATABASE_URL', readEnv('.env')) || getVar('DATABASE_URL', readEnv('.env.local'));
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not found'); process.exit(1); }
const sql = neon(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL });

const NFHL = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

async function femaZone(lat, lon) {
  lat = parseFloat(lat); lon = parseFloat(lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  const url = new URL(NFHL);
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'FLD_ZONE,ZONE_SUBTY,SFHA_TF');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const j = await res.json();
    if (j?.error) return null;
    const a = j?.features?.[0]?.attributes;
    if (!a) return { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false };
    return { zone: a.FLD_ZONE ?? null, subtype: a.ZONE_SUBTY ?? null, sfha: String(a.SFHA_TF).toUpperCase() === 'T' };
  } catch { return null; }
}

const RANK = { A: 0, B: 1, C: 2, D: 3 };
function floodCap(r) {           // worst grade flood alone justifies
  if (!r) return null;
  if (r.sfha) return 'D';
  if ((r.zone || '').toUpperCase() === 'X' && /0\.2\s*PCT/i.test(r.subtype || '')) return 'C';
  return null;
}
function worst(a, b) {           // lower-quality (higher rank) of two grades
  if (!a) return b; if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

const leads = await sql`
  SELECT "propertyId", "latitude", "longitude", "grade", "manualGrade"
  FROM "Lead"
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL
    AND ("floodZoneManual" IS NULL OR "floodZoneManual" = false)`;

console.log(`\n🌊 FEMA backfill — ${leads.length} leads with coordinates`);
console.log('━'.repeat(60));

let done = 0, sfha = 0, shaded = 0, capped = 0, failed = 0;
const CONC = 8;
for (let i = 0; i < leads.length; i += CONC) {
  const batch = leads.slice(i, i + CONC);
  await Promise.all(batch.map(async (l) => {
    const r = await femaZone(l.latitude, l.longitude);
    if (!r) { failed++; return; }
    if (r.sfha) sfha++;
    const cap = floodCap(r);
    if (cap === 'C') shaded++;
    // grade cap — never override a manual grade
    let newGrade = l.grade;
    if (!l.manualGrade && cap) { const w = worst(l.grade, cap); if (w !== l.grade) { newGrade = w; capped++; } }
    await pool.query(
      `UPDATE "Lead" SET "floodZone"=$1,"floodZoneType"=$2,"floodZoneSubtype"=$3,"floodSfha"=$4,
              "floodCheckedAt"=NOW(),"grade"=$5,"updatedAt"=NOW() WHERE "propertyId"=$6`,
      [r.sfha, r.zone, r.subtype, r.sfha, newGrade, l.propertyId]);
    done++;
  }));
  process.stdout.write(`\r  processed ${Math.min(i + CONC, leads.length)}/${leads.length}`);
}

console.log(`\n${'━'.repeat(60)}`);
console.log(`  updated ${done}   SFHA(high-risk) ${sfha}   shaded-X ${shaded}   grade-capped ${capped}   failed ${failed}`);
console.log('\n✅ FEMA backfill complete (free — no credits).');
await pool.end();
