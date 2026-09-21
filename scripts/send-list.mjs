/**
 * Build the E1 send list and its exclusion report (Frank's go/no-go, 21 Sep).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/send-list.mjs
 *         ... --step E2
 *         ... --csv recipients | --csv exclusions
 *
 * Read-only. Builds the list, proves it reconciles, and prints the exclusions by cause.
 * Nothing is staged or sent from here.
 */
import './lib/env.mjs';
import { loadCandidates, buildSendList } from '@/services/sendList.service';

const args = process.argv.slice(2);
const step = (args.includes('--step') ? args[args.indexOf('--step') + 1] : 'E1');
const csv = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;

/** Directive Sec. 1 — canonical cohorts, no shared boundary dates. */
const COHORTS = [
  ['C1', '2026-10-05', '2026-10-11'],
  ['C2', '2026-10-12', '2026-10-18'],
  ['C3', '2026-10-19', '2026-10-25'],
  ['C4', '2026-10-26', '2026-11-01'],
  ['C5', '2026-11-02', '2026-11-08'],
  ['C6', '2026-11-09', '2026-11-15'],
  ['C7', '2026-11-16', '2026-11-22'],
];

// One list across all seven, because dedup only works if it sees every cohort at once —
// "seven cohorts pulled at different times will contain repeats" (Frank, 21 Sep).
const all = [];
for (const [, from, to] of COHORTS) all.push(...await loadCandidates(from, to));

const list = await buildSendList(all, step);

if (csv === 'recipients') {
  console.log('leadId,propertyId,cohort,email,role,firstName,lastName,householdKey,confirmed');
  for (const r of list.recipients) {
    console.log([r.leadId, r.propertyId, r.cohort, r.email, r.role, r.firstName, r.lastName, r.householdKey, r.confirmed]
      .map((v) => `"${v ?? ''}"`).join(','));
  }
  process.exit(0);
}
if (csv === 'exclusions') {
  console.log('leadId,propertyId,cohort,reason,detail');
  for (const e of list.exclusions) {
    console.log([e.leadId, e.propertyId, e.cohort, e.reason, e.detail].map((v) => `"${v ?? ''}"`).join(','));
  }
  process.exit(0);
}

console.log(`\n=== ${step} SEND LIST — all seven cohorts ===\n`);
console.log(`  Grade A leads considered : ${list.counts.leadsConsidered}`);
console.log(`  distinct households      : ${list.counts.households}`);
console.log(`  RECIPIENTS               : ${list.counts.recipients}`);
console.log(`  reconciles (mailed + excluded = considered): ${list.reconciles ? 'YES' : 'NO — DO NOT SEND'}`);

console.log('\n--- exclusions by cause ---');
console.table(Object.entries(list.counts.excluded)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1])
  .map(([reason, leads]) => ({ reason, leads })));

const byCohort = new Map();
for (const r of list.recipients) {
  const c = r.cohort ?? 'untagged';
  byCohort.set(c, (byCohort.get(c) ?? 0) + 1);
}
console.log('--- recipients per cohort ---');
console.table([...byCohort.entries()].sort().map(([cohort, recipients]) => ({
  cohort, recipients, tranche1: Math.round(recipients * 0.25), tranche2: recipients - Math.round(recipients * 0.25),
})));

const dupes = list.exclusions.filter((e) => e.reason === 'duplicate_household' || e.reason === 'duplicate_address');
if (dupes.length) {
  console.log(`\n--- the repeats Instantly would not have caught (first 10 of ${dupes.length}) ---`);
  for (const d of dupes.slice(0, 10)) console.log(`  ${d.leadId}  ${d.reason}  ${d.detail}`);
}
