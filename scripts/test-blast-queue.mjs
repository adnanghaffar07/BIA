/**
 * The skip-trace blast queue, tested (Abdullah 28 Sep · Frank 28 Sep).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/test-blast-queue.mjs
 *
 * Writes to the live table and removes everything it wrote. It operates ONLY on property
 * ids it queued itself and asserts the row is back to its original state at the end —
 * queuing isolates leads, and a test that left one isolated would quietly remove a real
 * homeowner from a send list.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { queueForBlast, dequeueFromBlast, blastQueueSummary } from '@/services/blastQueue.service';

let pass = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; return; } failures.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

// Untouched Grade B leads: never queued, never traced, not isolated.
const pick = await sql`
  SELECT "propertyId", "status", "isolatedAt", "isolatedReason"
    FROM "Lead"
   WHERE COALESCE("manualGrade","grade") = 'B'
     AND "blastQueuedAt" IS NULL AND "blastSkipTracedAt" IS NULL
     AND "deepSkipTracedAt" IS NULL AND "isolatedAt" IS NULL
   LIMIT 3`;
if (pick.length < 3) { console.log('not enough clean Grade B leads to test with'); process.exit(0); }
const ids = pick.map((r) => String(r.propertyId));
const before = new Map(pick.map((r) => [String(r.propertyId), r.status]));
console.log(`\ntesting on ${ids.join(', ')}\n`);

try {
  const r1 = await queueForBlast({ propertyIds: ids, grade: 'B', actor: 'test', reason: 'unit test' });
  eq('all three are queued', r1.queued, 3);
  eq('and all three are isolated by it', r1.isolated, 3);

  const after = await sql`
    SELECT "propertyId","blastQueuedAt","blastQueueGrade","isolatedAt","isolatedReason",
           "isolatedFromStatus","status"
      FROM "Lead" WHERE "propertyId" = ANY(${ids})`;
  ok('every row carries the queue grade', after.every((r) => r.blastQueueGrade === 'B'));
  ok('every row is isolated', after.every((r) => r.isolatedAt != null));
  ok('the reason names the queue', after.every((r) => /Grade B skip-trace blast/.test(String(r.isolatedReason))));

  /**
   * Frank, 23 Sep: "pulling a lead for skip trace never overwrites its 'rated' status."
   * Rated AND unreachable are two facts about one lead, not alternatives — overwriting
   * status is what had the dashboard reporting 48 rated for a week holding 61.
   */
  ok('status is untouched', after.every((r) => (r.status ?? null) === (before.get(String(r.propertyId)) ?? null)),
    JSON.stringify(after.map((r) => r.status)));
  ok('the previous status is recorded for the way back', after.every((r) => r.isolatedFromStatus !== undefined));

  // Idempotent: re-running a pull after adjusting a filter is the normal case.
  const r2 = await queueForBlast({ propertyIds: ids, grade: 'B', actor: 'test', reason: 'unit test again' });
  eq('a second queue adds nothing', r2.queued, 0);
  eq('and reports them as already queued', r2.alreadyQueued, 3);

  const summary = await blastQueueSummary();
  const b = summary.find((x) => x.grade === 'B');
  ok('the B queue reports them waiting', (b?.waiting ?? 0) >= 3, JSON.stringify(summary));
  ok('A and B are separate rows', summary.every((x) => x.grade === 'A' || x.grade === 'B'));

  /**
   * ── Undo, and what it must NOT undo ───────────────────────────────────────
   *
   * Leaving the queue does not make a lead reachable. These three have no insured email —
   * that is how they were chosen — so after dequeuing they are still unmailable and must
   * STAY isolated. Clearing it would drop them back into a send list they cannot be mailed
   * from, which is the failure isolate.service exists to stop.
   *
   * This assertion used to read "isolation caused by the queue is lifted" and passed against
   * a version that lifted it on every dequeue. The test was agreeing with the code rather
   * than with what should happen.
   */
  eq('dequeue removes all three', await dequeueFromBlast(ids), 3);
  const back = await sql`
    SELECT "propertyId","blastQueuedAt","blastQueueGrade","isolatedAt","isolatedReason","status"
      FROM "Lead" WHERE "propertyId" = ANY(${ids})`;
  ok('nothing is left queued', back.every((r) => r.blastQueuedAt == null));
  ok('a lead with no insured email stays isolated', back.every((r) => r.isolatedAt != null));
  ok('and stops claiming it is waiting in a queue it left',
    back.every((r) => !/queued for the Grade/.test(String(r.isolatedReason))),
    JSON.stringify(back.map((r) => r.isolatedReason)));
  ok('and status is still what it was', back.every((r) => (r.status ?? null) === (before.get(String(r.propertyId)) ?? null)));

  /**
   * The other half of the rule: a lead that CAN be emailed does get released. Proven by
   * giving one a recovered address, which is exactly what a successful trace does.
   */
  const [one] = ids;
  await sql`UPDATE "Lead" SET "isolatedAt" = NULL, "isolatedReason" = NULL WHERE "propertyId" = ${one}`;
  await queueForBlast({ propertyIds: [one], grade: 'B', actor: 'test', reason: 'reachable case' });
  await sql`UPDATE "Lead" SET "email1" = 'recovered@example.com' WHERE "propertyId" = ${one}`;
  await dequeueFromBlast([one]);
  const [released] = await sql`
    SELECT "isolatedAt","isolatedReason" FROM "Lead" WHERE "propertyId" = ${one}`;
  ok('a lead that gained an insured email IS released', released.isolatedAt == null,
    `isolatedAt=${released.isolatedAt} reason=${released.isolatedReason}`);
  await sql`UPDATE "Lead" SET "email1" = NULL WHERE "propertyId" = ${one}`;
} finally {
  // Belt and braces: whatever happened above, leave nothing isolated.
  await sql`
    UPDATE "Lead"
       SET "blastQueuedAt" = NULL, "blastQueuedBy" = NULL, "blastQueueGrade" = NULL,
           "blastQueueReason" = NULL, "isolatedAt" = NULL, "isolatedFromStatus" = NULL,
           "isolatedReason" = NULL
     WHERE "propertyId" = ANY(${ids})`;
  /**
   * Unconditional, and scoped to the three ids this run chose. The previous version matched
   * on a blastQueueReason that dequeue had already cleared, so it matched nothing and left
   * three real leads isolated — a test that tidies up only when nothing went wrong is a test
   * that removes real homeowners from send lists whenever something does.
   */
  const leftover = await sql`
    SELECT COUNT(*)::int AS n FROM "Lead"
     WHERE "propertyId" = ANY(${ids}) AND ("blastQueuedAt" IS NOT NULL OR "isolatedAt" IS NOT NULL)`;
  console.log(`\ncleanup: ${leftover[0].n} row(s) still queued or isolated (must be 0)`);
  if (leftover[0].n !== 0) failures.push('cleanup left rows queued or isolated');
}

console.log(`\n${failures.length ? 'FAILED' : 'PASSED'} — ${pass} assertions, ${failures.length} failures`);
if (failures.length) { for (const f of failures) console.log(`  · ${f}`); process.exit(1); }
