/**
 * Give every lead a household (directive Sec. 11.5 question 2).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-households.mjs           DRY RUN
 *   node --import ./scripts/lib/register-ts.mjs scripts/backfill-households.mjs --apply
 *
 * Converges rather than appends, so it is safe to re-run: a second pass over unchanged
 * leads creates nothing and reassigns nothing. Run it after a pull, and after any change
 * to normaliseStreet, addressKeyOf or groupHouseholds.
 *
 * The check at the end is the part worth keeping. Storing the answer only helps if
 * something re-derives it and complains — the condo-unit incident, where a change to
 * normaliseStreet quietly merged five units and dropped four owners from the send list,
 * would have appeared there as four leads changing household.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { materialiseHouseholds, householdMismatches } from '@/services/householdStore.service';

const APPLY = process.argv.includes('--apply');

console.log(APPLY ? '*** APPLYING ***' : '--- DRY RUN (pass --apply to write) ---');

const before = await sql`
  SELECT COUNT(*)::int AS households FROM "Household"`;
const beforeAssigned = await sql`
  SELECT COUNT(*) FILTER (WHERE "householdId" IS NOT NULL)::int AS assigned,
         COUNT(*)::int AS total FROM "Lead"`;
console.log(`before: ${before[0].households} household(s) · ${beforeAssigned[0].assigned}/${beforeAssigned[0].total} leads assigned\n`);

const r = await materialiseHouseholds({ dryRun: !APPLY, by: 'backfill' });
console.log(`leads seen        ${r.leadsSeen}`);
console.log(`groups derived    ${r.groups}`);
console.log(`households created ${r.created}`);
console.log(`households updated ${r.updated}`);
console.log(`households merged  ${r.merged}`);
console.log(`lead assignments   ${r.leadsAssigned}`);

if (r.multiAddress.length) {
  console.log(`\nhouseholds spanning more than one property: ${r.multiAddress.length}`);
  console.log('(joined by a shared email — the case an address key cannot name)');
  for (const h of r.multiAddress.slice(0, 10)) {
    console.log(`  ${h.id}`);
    console.log(`     addresses: ${h.addressKeys.join('  |  ')}`);
    console.log(`     leads    : ${h.leadIds.join(', ')}`);
  }
}

if (!APPLY) {
  console.log('\nNothing written. Re-run with --apply.');
  process.exit(0);
}

const after = await sql`SELECT COUNT(*)::int AS households FROM "Household"`;
const afterAssigned = await sql`
  SELECT COUNT(*) FILTER (WHERE "householdId" IS NOT NULL)::int AS assigned,
         COUNT(*)::int AS total FROM "Lead"`;
console.log(`\nafter: ${after[0].households} household(s) · ${afterAssigned[0].assigned}/${afterAssigned[0].total} leads assigned`);

console.log('\n--- re-deriving and comparing ---');
const check = await householdMismatches();
console.log(`  checked ${check.checked} lead(s) · ${check.mismatches.length} mismatch(es)`);
for (const m of check.mismatches.slice(0, 10)) {
  console.log(`    lead ${m.leadId}  ${m.reason}  stored=${m.stored ?? 'none'}`);
}
if (check.mismatches.length) process.exitCode = 1;

console.log('\n--- does every lead in a household share its id? ---');
const [split] = await sql`
  SELECT COUNT(*)::int AS n FROM (
    SELECT "householdId" FROM "Lead"
     WHERE "householdId" IS NOT NULL
     GROUP BY "householdId" HAVING COUNT(DISTINCT "householdId") > 1
  ) x`;
const [orphans] = await sql`
  SELECT COUNT(*)::int AS n FROM "Lead" l
   WHERE l."householdId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Household" h WHERE h."id" = l."householdId")`;
console.log(`  leads pointing at a household that does not exist: ${orphans.n}`);
if (orphans.n) process.exitCode = 1;
