/**
 * Take leads back out of a skip-trace blast queue.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/unqueue-blast.mjs <propertyId> [...]
 *   node --import ./scripts/lib/register-ts.mjs scripts/unqueue-blast.mjs --grade B --all
 *
 * Queuing isolates a lead, which keeps it out of every send list until a trace returns an
 * address. That is correct while it is queued and wrong the moment it is not, so the way
 * back has to exist and has to be as easy as the way in — otherwise the safe move is never
 * to press the button.
 *
 * Isolation is lifted ONLY where this queue caused it. A lead isolated earlier for having
 * no insured email is still unreachable after it leaves the queue, and clearing that would
 * put it back into a list it cannot be mailed from.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { dequeueFromBlast, blastQueueSummary } from '@/services/blastQueue.service';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const gradeArg = args.includes('--grade') ? args[args.indexOf('--grade') + 1] : null;
const ids = args.filter((a) => !a.startsWith('--') && a !== gradeArg);

let targets = ids;

if (ALL) {
  const grade = gradeArg === 'B' ? 'B' : gradeArg === 'A' ? 'A' : null;
  if (!grade) {
    console.error('--all needs a queue: --grade A or --grade B');
    process.exit(2);
  }
  const rows = await sql`
    SELECT "propertyId" FROM "Lead"
     WHERE "blastQueuedAt" IS NOT NULL AND "blastQueueGrade" = ${grade}
       AND "blastSkipTracedAt" IS NULL`;
  targets = rows.map((r) => String(r.propertyId));
  console.log(`emptying the Grade ${grade} queue — ${targets.length} lead(s) still waiting`);
}

if (!targets.length) {
  console.error('Nothing to do. Pass property ids, or --grade A|B --all.');
  process.exit(2);
}

const removed = await dequeueFromBlast(targets);
console.log(`removed ${removed} of ${targets.length} from the queue`);

const left = await sql`
  SELECT "propertyId","blastQueuedAt","isolatedAt","isolatedReason","status"
    FROM "Lead" WHERE "propertyId" = ANY(${targets})`;
const stillQueued = left.filter((r) => r.blastQueuedAt != null).length;
const stillIsolated = left.filter((r) => r.isolatedAt != null);
console.log(`still queued: ${stillQueued} (must be 0)`);
console.log(`still isolated: ${stillIsolated.length}`);
for (const r of stillIsolated.slice(0, 5)) {
  console.log(`   ${r.propertyId} — ${r.isolatedReason ?? '(no reason recorded)'}`);
}
if (stillIsolated.length) {
  console.log('   ^ these were isolated for a reason other than this queue, so they stay isolated.');
}

console.log('\nqueues now:');
const qs = await blastQueueSummary();
if (!qs.length) console.log('  both empty');
for (const q of qs) console.log(`  Grade ${q.grade}: ${q.waiting} waiting · ${q.traced} traced`);
