/**
 * Undo one isolation run, in full.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/revert-isolation-batch.mjs <isolatedAt>
 *         ... --apply
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * On 18 Sep 2026 the live "Isolate" button was pressed against effective dates
 * 2026-11-16 → 2026-11-22 while the credits banner was being tested. Nobody had asked for
 * that cohort to be isolated. 222 leads were parked as unreachable and enrolled in the
 * recovery pipeline in one pass.
 *
 * ── Why the timestamp is the batch key ──────────────────────────────────────
 * isolateUnreachable() takes a single `new Date()` before its loop and stamps every lead
 * it touches with it. One run is therefore exactly one distinct isolatedAt, to the
 * millisecond — a precise, self-evident boundary that needs no list of ids and cannot
 * accidentally sweep up a lead isolated by a different run, or by hand, seconds later.
 *
 * ── What is restored, and what is deliberately not ──────────────────────────
 * Isolation was built to be reversible: isolatedFromStatus carries what the lead was, so
 * putting it back is exact rather than a guess at "new". The pipeline enrolment goes too —
 * it was created by this run and describes nothing that happened on its own.
 *
 * deepSkipTracedAt and skipTraceData are NOT touched. A trace that really ran is a fact
 * about the lead, not part of the isolation, and recoveryTracerfyAt was only ever a copy
 * of it. Clearing the copy loses nothing; clearing the original would be a lie.
 *
 * A lead that has been recovered since the run is left alone and reported: it has an
 * address now, somebody acted on it, and rolling that back would discard real work.
 */
import './lib/env.mjs';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const stamp = process.argv.find((a) => !a.startsWith('--') && /^\d{4}-\d{2}-\d{2}/.test(a));
const apply = process.argv.includes('--apply');

if (!stamp) {
  console.error('Pass the isolatedAt of the run to revert, e.g. "2026-09-18 14:58:38.034".');
  process.exit(1);
}

const rows = await sql`
  SELECT "id", "propertyId", "owner1FirstName", "owner1LastName", "effectiveDate"::text AS eff,
         "status", "isolatedFromStatus", "recoveryStage", "recoveredAt"
    FROM "Lead"
   WHERE "isolatedAt" = ${stamp}::timestamptz
   ORDER BY "effectiveDate", "owner1LastName"`;

if (!rows.length) {
  console.error(`No leads carry isolatedAt = ${stamp}. Nothing to revert.`);
  process.exit(1);
}

// Recovered since = somebody found an address for this lead after the run. That is real
// work and it outranks undoing the run, so it is skipped and named rather than reverted.
const recovered = rows.filter((r) => r.recoveredAt != null);
const targets = rows.filter((r) => r.recoveredAt == null);

const backTo = {};
for (const r of targets) {
  const to = r.isolatedFromStatus || 'new';
  backTo[`${r.status} → ${to}`] = (backTo[`${r.status} → ${to}`] ?? 0) + 1;
}

console.log(`\nIsolation run of ${stamp}`);
console.log(`  leads stamped by the run : ${rows.length}`);
console.log(`  recovered since (skipped): ${recovered.length}`);
console.log(`  to revert                : ${targets.length}`);
console.log('\n  status change:');
for (const [k, n] of Object.entries(backTo).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(4)}  ${k}`);
}
for (const r of recovered) {
  console.log(`\n  left alone (recovered ${String(r.recoveredAt).slice(0, 19)}): `
    + `${r.propertyId} ${r.owner1FirstName} ${r.owner1LastName}`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write.\n');
  process.exit(0);
}

const { updateLead, addActivity } = await import('../src/services/storage.service.ts');

let done = 0;
for (const r of targets) {
  const back = r.isolatedFromStatus || 'new';
  await updateLead(r.propertyId ?? r.id, {
    status: back,
    isolatedAt: null,
    isolatedFromStatus: null,
    isolatedReason: null,
    // The enrolment was made by the same run and has no meaning without it.
    recoveryStage: null,
    recoveryEnteredAt: null,
    recoveryTracerfyAt: null,
  });
  await addActivity(
    r.id,
    'status_change',
    `Status: isolated → ${back} (isolation run of ${String(stamp).slice(0, 19)} reverted — cohort was isolated in error)`,
    {
      changes: [{ field: 'Status', from: 'isolated', to: back }],
      revertedIsolationAt: stamp,
      previousRecoveryStage: r.recoveryStage ?? null,
    },
    'revert-isolation (system)',
  );
  done++;
  if (done % 25 === 0) console.log(`  … ${done}/${targets.length}`);
}

const [left] = await sql`
  SELECT COUNT(*)::int AS n FROM "Lead" WHERE "isolatedAt" = ${stamp}::timestamptz`;

console.log(`\nReverted ${done}. Still carrying that stamp: ${left.n}`
  + (left.n === recovered.length ? ' (the recovered leads, left alone as intended).' : ' — expected only the recovered ones.'));
