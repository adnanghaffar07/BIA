/**
 * Task 41 / directive Sec. 13 — what is actually in the Grade B pool.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/grade-b-composition.mjs
 *         ... --csv
 *
 * ── The question ────────────────────────────────────────────────────────────
 * ~600 leads are assumed to be Grade B "only for roof age". That has never been checked,
 * and the CRM review found the roof requirement gates on HOUSE age rather than roof age:
 *
 *     appliesWhen: !yearBuilt || (thisYear - yearBuilt) > 20      // built 2005 or earlier
 *
 * So a 1960 house with a roof replaced last year is still asked for a roof year, because
 * the rule never looks at the roof — it looks at when the house was built. If that is what
 * put the pool at B, much of it is penalised for its build year rather than an unknown
 * roof, and a roof-age append would not move it.
 *
 * ── How "roof-driven" is decided ────────────────────────────────────────────
 * Grade B means EXACTLY ONE critical field is missing. So the question has a precise
 * answer per lead: is that one field roofYear, or something else?
 *
 * This asks the grading service itself (getMissingCriticalFields) rather than
 * re-implementing the rule in SQL. A second implementation is how two numbers that should
 * be the same end up differing, and this whole exercise exists because of numbers that
 * differed.
 *
 * Nothing is written. Sec. 13: no Grade B campaign is authorised, and nothing inferred
 * may write a grade downgrade.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { getMissingCriticalFields, isCondo } from '@/services/grade.service';

const csv = process.argv.includes('--csv');

const leads = await sql`
  SELECT * FROM "Lead"
   WHERE COALESCE("manualGrade", "grade") = 'B'`;

const decade = (yb) => {
  const y = Number(yb);
  if (!y) return 'unknown';
  if (y < 1940) return 'pre-1940';
  return `${Math.floor(y / 10) * 10}s`;
};

const rows = leads.map((l) => {
  const missing = getMissingCriticalFields(l);
  return {
    id: l.id,
    propertyType: isCondo(l) ? 'CONDO' : (l.propertyType || 'unknown'),
    yearBuilt: Number(l.yearBuilt) || null,
    decade: decade(l.yearBuilt),
    municipality: l.addressCity || 'unknown',
    county: l.addressCounty || 'unknown',
    missing,
    // Grade B is "exactly one missing", so the sole missing field IS the cause.
    soleCause: missing.length === 1 ? missing[0] : `${missing.length} fields`,
    roofDriven: missing.length === 1 && /roof/i.test(missing[0]),
    hasRoofYear: !!Number(l.roofYear),
    // The rule's own trigger: it asks for a roof year on any home older than 20 years.
    ruleTriggeredByAge: !Number(l.yearBuilt) || (2026 - Number(l.yearBuilt)) > 20,
  };
});

const tally = (key) => {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const roofDriven = rows.filter((r) => r.roofDriven);
const notRoof = rows.filter((r) => !r.roofDriven);

if (csv) {
  console.log('id,propertyType,yearBuilt,decade,municipality,county,soleCause,roofDriven,hasRoofYear');
  for (const r of rows) {
    console.log([r.id, r.propertyType, r.yearBuilt ?? '', r.decade, r.municipality, r.county,
      r.soleCause, r.roofDriven, r.hasRoofYear].map((v) => `"${v}"`).join(','));
  }
  process.exit(0);
}

console.log(`\n=== GRADE B POOL — ${leads.length} leads ===\n`);

console.log('--- Is the downgrade roof-driven at all? ---');
console.log(`  roof year is the ONLY missing field : ${roofDriven.length}  (${Math.round(roofDriven.length / leads.length * 100)}%)`);
console.log(`  something else                      : ${notRoof.length}  (${Math.round(notRoof.length / leads.length * 100)}%)`);

console.log('\n--- What the single missing field actually is ---');
console.table(tally('soleCause').map(([cause, n]) => ({ 'sole missing field': cause, leads: n })));

console.log('--- By property type ---');
console.table(tally('propertyType').map(([t, n]) => ({ propertyType: t, leads: n })));

console.log('--- By year-built decade ---');
console.table(tally('decade')
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  .map(([d, n]) => ({ decade: d, leads: n })));

console.log('--- By municipality (top 15) ---');
console.table(tally('municipality').slice(0, 15).map(([m, n]) => ({ municipality: m, leads: n })));

console.log('--- By county ---');
console.table(tally('county').map(([c, n]) => ({ county: c, leads: n })));

/**
 * The claim worth testing: the rule asks for a roof year because the HOUSE is old, not
 * because the roof is. A roof-driven lead that already carries a roof year would be a
 * contradiction; one whose house is new enough that the rule should not have fired at all
 * is the rule misapplying.
 */
console.log('\n--- Sanity on the roof-driven group ---');
console.log(`  of the ${roofDriven.length} roof-driven leads:`);
console.log(`    already have a roof year on file : ${roofDriven.filter((r) => r.hasRoofYear).length}  (should be 0)`);
console.log(`    rule fired because the HOUSE is >20 yrs old or undated : ${roofDriven.filter((r) => r.ruleTriggeredByAge).length}`);
console.log(`    built 2006 or later (rule should not fire) : ${roofDriven.filter((r) => !r.ruleTriggeredByAge).length}`);
const byDecadeRoof = new Map();
for (const r of roofDriven) byDecadeRoof.set(r.decade, (byDecadeRoof.get(r.decade) ?? 0) + 1);
console.log('\n  roof-driven, by decade built:');
console.table([...byDecadeRoof.entries()].sort().map(([d, n]) => ({ decade: d, leads: n })));
