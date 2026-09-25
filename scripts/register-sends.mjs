/**
 * Register the CSV-uploaded contacts so replies route back into the CRM.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/register-sends.mjs 2026-10-05 2026-10-19
 *   node --import ./scripts/lib/register-ts.mjs scripts/register-sends.mjs 2026-10-05 2026-10-19 --write
 *   ... --campaign=<instantly campaign id>     (optional, better when known)
 *
 * Run this BEFORE the first email goes out. A reply that arrives before the row exists is
 * matched against nothing and dropped -- it cannot be recovered afterwards, because all the
 * platform sends is an address and an event.
 */
import './lib/env.mjs';
import { registerSends, registrationCoverage } from '@/services/registerSends.service';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FROM = args[0] || '2026-10-05';
const TO = args[1] || '2026-10-19';
const WRITE = process.argv.includes('--write');
const camp = process.argv.find((a) => a.startsWith('--campaign='));
const campaignId = camp ? camp.slice('--campaign='.length) : null;

const before = await registrationCoverage({ effFrom: FROM, effTo: TO });
console.log(`${FROM} to ${TO}`);
console.log(`  before: ${before.registered} of ${before.onList} accounts can receive a reply\n`);

const r = await registerSends({ effFrom: FROM, effTo: TO, campaignId, dryRun: !WRITE });
console.log(`  ${r.considered} contacts considered`);
console.log(`  ${r.registered} registered${WRITE ? '' : ' (would be)'}`);
console.log(`  ${r.alreadyRegistered} already registered`);
console.log(`  ${r.heldSkipped} skipped — held by the surname review`);
console.log(`  campaign id: ${campaignId ?? '(not supplied — the webhook will learn it from the first event)'}`);
if (r.byCohort.length) {
  console.log('\n  by renewal week:');
  for (const c of r.byCohort) console.log(`     ${c.cohort}  ${c.n}`);
}

if (!WRITE) { console.log('\nDRY RUN — nothing written. Re-run with --write.'); process.exit(0); }
const after = await registrationCoverage({ effFrom: FROM, effTo: TO });
console.log(`\n  after: ${after.registered} of ${after.onList} accounts can receive a reply`);
if (after.unregistered) console.log(`  ${after.unregistered} still cannot — every address held for review`);
