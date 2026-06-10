import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const sql = neon(env.match(/DATABASE_URL="([^"]+)"/)[1]);

const OUT_OF_APPETITE = new Set(['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701']);

const rows = await sql`
  SELECT "addressZip", "addressCity", "grade", "travelersEligible", "plymouthEligible"
  FROM "Lead"
  ORDER BY "addressZip"
`;

const inAppetite   = rows.filter(r => !OUT_OF_APPETITE.has((r.addressZip||'').slice(0,5)));
const outAppetite  = rows.filter(r => OUT_OF_APPETITE.has((r.addressZip||'').slice(0,5)));

console.log(`\nTotal leads: ${rows.length}`);
console.log(`  ✅ In-appetite ZIPs:     ${inAppetite.length}`);
console.log(`  🚫 Out-of-appetite ZIPs: ${outAppetite.length}`);

if (outAppetite.length > 0) {
  console.log('\nLeads from EXCLUDED ZIPs:');
  outAppetite.forEach(r => console.log(`  ZIP ${r.addressZip} | ${r.addressCity} | Grade ${r.grade} | T:${r.travelersEligible} P:${r.plymouthEligible}`));
}

console.log('\nGrade breakdown:');
const grades = {};
rows.forEach(r => { grades[r.grade] = (grades[r.grade]||0)+1; });
Object.entries(grades).sort().forEach(([g,c]) => console.log(`  Grade ${g}: ${c}`));

console.log('\nSample ZIP codes in DB (first 15):');
const zips = [...new Set(rows.map(r => r.addressZip))].slice(0, 15);
console.log(' ', zips.join(', '));
