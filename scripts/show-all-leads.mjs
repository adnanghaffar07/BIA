import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const sql = neon(readFileSync('.env', 'utf-8').match(/DATABASE_URL="([^"]+)"/)[1]);

const rows = await sql`
  SELECT
    ROW_NUMBER() OVER (ORDER BY "addressZip", "addressStreet") AS "#",
    "propertyId",
    "addressStreet",
    "addressCity",
    "addressZip",
    "owner1FirstName",
    "owner1LastName",
    "yearBuilt",
    "squareFeet",
    "bedrooms",
    "estimatedValue",
    "engine",
    "grade",
    "travelersEligible",
    "plymouthEligible",
    "expectedPremium",
    "coastDistanceMiles",
    "coastExposure",
    "status"
  FROM "Lead"
  ORDER BY "addressZip", "addressStreet"
`;

console.log(`\nTotal leads in DB: ${rows.length}\n`);
console.log(
  '#'.padEnd(4) +
  'ZIP'.padEnd(8) +
  'Address'.padEnd(32) +
  'City'.padEnd(18) +
  'Owner'.padEnd(24) +
  'Yr'.padEnd(6) +
  'SqFt'.padEnd(8) +
  'Value'.padEnd(12) +
  'Eng'.padEnd(5) +
  'Grade'.padEnd(7) +
  'Travelers'.padEnd(12) +
  'Plymouth'.padEnd(12) +
  'Premium'.padEnd(10) +
  'Coast'
);
console.log('─'.repeat(180));

for (const r of rows) {
  const owner = [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ') || '(no name)';
  const value = r.estimatedValue ? `$${Number(r.estimatedValue).toLocaleString()}` : '—';
  const premium = r.expectedPremium ? `$${Number(r.expectedPremium).toLocaleString()}` : '—';
  const coast = r.coastDistanceMiles != null ? `${r.coastDistanceMiles}mi ${r.coastExposure}` : '—';
  console.log(
    String(r['#']).padEnd(4) +
    (r.addressZip || '').padEnd(8) +
    (r.addressStreet || '').slice(0,31).padEnd(32) +
    (r.addressCity || '').slice(0,17).padEnd(18) +
    owner.slice(0,23).padEnd(24) +
    String(r.yearBuilt || '—').padEnd(6) +
    String(r.squareFeet || '—').padEnd(8) +
    value.padEnd(12) +
    String(r.engine || '—').padEnd(5) +
    (r.grade || '—').padEnd(7) +
    (r.travelersEligible || '—').padEnd(12) +
    (r.plymouthEligible || '—').padEnd(12) +
    premium.padEnd(10) +
    coast
  );
}

// Summary
const grades = {};
const byZip = {};
rows.forEach(r => {
  grades[r.grade] = (grades[r.grade]||0)+1;
  byZip[r.addressZip] = (byZip[r.addressZip]||0)+1;
});

console.log('\n' + '─'.repeat(60));
console.log('GRADE BREAKDOWN:');
Object.entries(grades).sort().forEach(([g,c]) => console.log(`  Grade ${g}: ${c} leads`));
console.log('\nBY ZIP CODE:');
Object.entries(byZip).sort().forEach(([z,c]) => console.log(`  ${z}: ${c} leads`));
