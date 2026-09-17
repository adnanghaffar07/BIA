/**
 * Re-grade leads using the app's OWN rules.
 *
 * Usage:
 *   node --import ./scripts/lib/register-ts.mjs scripts/regrade.mjs
 *       → dry run. Always reports EVERY disagreement; writes nothing.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/regrade.mjs --apply
 *       → write the leads the rules grade A that are stored lower (or ungraded)
 *
 *   ... --all-upgrades          also write upgrades that land on B or C
 *   ... --allow-downgrades      also write grades that move DOWN (see the warning below)
 *   ... --ids=a,b,c             restrict to specific lead ids
 *
 * ── Why this script was rewritten ────────────────────────────────────────────
 *
 * It used to keep its own copy of grade.service's rules. The copy fell behind the condo
 * exemption (CONDO_EXEMPT_FIELDS — condos are not rated on roof age, year built, square
 * footage or bedroom count), and since ~1,200 of the Grade A leads are condos, a write
 * pass would have moved 769 of them out of A. It was quarantined behind a scary flag
 * rather than fixed, which left the real problem — a second implementation of a rule is
 * a second thing to get wrong — in place.
 *
 * It now imports calculateLeadGrade from src/services/grade.service.ts directly, so there
 * is exactly one set of rules and this script cannot drift from the app again. That
 * includes carrier appetite, the flood caps and the post-skip-trace contactability rule,
 * none of which the old copy implemented.
 *
 * ── Why upgrades-only is the default ─────────────────────────────────────────
 *
 * A stored grade can be lower than the computed one for a boring reason: something wrote
 * a grade and nothing recomputed it afterwards. The Sep-2026 skip-trace middle-name
 * repair, for example, lifted 22 leads off D by writing 'B' so they would pass
 * canRunSkipTrace, then re-traced them successfully — and the B stuck. Those leads are
 * quote-ready and reading as "needs info".
 *
 * A downgrade is a different animal. It takes a lead AWAY from a producer, possibly out
 * of a campaign that is mid-flight, and the computed value depends on stored carrier and
 * flood columns that may themselves be stale. So downgrades need --allow-downgrades and
 * a person who has looked at the dry run.
 *
 * Manual overrides are never touched, in either direction.
 */
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { calculateLeadGrade } from '@/services/grade.service.ts';

const APPLY        = process.argv.includes('--apply');
const ALL_UPGRADES = process.argv.includes('--all-upgrades');
const DOWNGRADES   = process.argv.includes('--allow-downgrades');
const idsArg     = process.argv.find((a) => a.startsWith('--ids='));
const ONLY_IDS   = idsArg ? idsArg.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;

const env = ['.env', '.env.local']
  .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })
  .join('\n');
const url = /DATABASE_URL\s*=\s*"?([^"\n]+)"?/.exec(env)?.[1]?.trim();
if (!url) throw new Error('DATABASE_URL not found in .env / .env.local');

const pool = new Pool({ connectionString: url });

/**
 * Every column the grading path reads — grade.service's pertinent fields, the condo and
 * flood checks, the contactability rule, and everything carrier.service touches.
 *
 * Listed explicitly rather than SELECT *: "Lead" carries rawData and skipTraceData, which
 * nothing here reads and which are large enough to have blown the Neon transfer quota
 * once already.
 */
const WANTED = [
  'id', 'propertyId', 'grade', 'manualGrade',
  'owner1LastName', 'addressStreet', 'addressCity', 'addressZip',
  'estimatedValue', 'yearBuilt', 'squareFeet', 'bedrooms', 'roofYear', 'roofType',
  'propertyType', 'propertyUse', 'landUse', 'unitsCount',
  'latitude', 'longitude', 'mailCity', 'mailStreet',
  'floodZone', 'floodZoneType', 'floodZoneSubtype', 'floodSfha',
  'skipTraced', 'phone1', 'phone2', 'email1', 'email2',
  'absenteeOwner', 'corporateOwned', 'foreclosure', 'preForeclosure',
  'investorBuyer', 'ownerOccupied', 'reo', 'vacant',
];
const RANK = { A: 0, B: 1, C: 2, D: 3 };

// Some of the names above exist only on raw REAPI records, not as columns (the services
// read both shapes). Ask the schema rather than guessing, and say which were dropped —
// a silently missing column here would quietly change what the rules see.
const { rows: schema } = await pool.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'Lead'`,
);
const present = new Set(schema.map((r) => r.column_name));
const COLS    = WANTED.filter((c) => present.has(c));
const absent  = WANTED.filter((c) => !present.has(c));
if (absent.length) console.log(`  (not columns, skipped: ${absent.join(', ')})`);
for (const required of ['id', 'grade', 'manualGrade']) {
  if (!present.has(required)) throw new Error(`"Lead"."${required}" is missing — cannot re-grade`);
}

const { rows: leads } = await pool.query(
  `SELECT ${COLS.map((c) => `"${c}"`).join(',')} FROM "Lead"
    WHERE "manualGrade" IS NULL
    ${ONLY_IDS ? 'AND "id" = ANY($1)' : ''}`,
  ONLY_IDS ? [ONLY_IDS] : [],
);

const before = {}, after = {};
const moves  = {};
/** EVERY difference, regardless of what this run is allowed to write. */
const diffs = [];

for (const l of leads) {
  const from = l.grade ?? null;
  const to   = calculateLeadGrade(l);
  before[from ?? '(null)'] = (before[from ?? '(null)'] ?? 0) + 1;
  after[to] = (after[to] ?? 0) + 1;
  if (from === to) continue;

  const isUpgrade = from == null || RANK[to] < RANK[from];
  moves[`${from ?? '(null)'} → ${to}`] = (moves[`${from ?? '(null)'} → ${to}`] ?? 0) + 1;
  diffs.push({ ...l, from, to, isUpgrade });
}

const toA        = diffs.filter((r) => r.isUpgrade && r.to === 'A');
const otherUp    = diffs.filter((r) => r.isUpgrade && r.to !== 'A');
const downgrades = diffs.filter((r) => !r.isUpgrade);

// Counted off `diffs`, not off the write list — reporting "downgrades 0" because this run
// happens not to be writing them is how someone concludes there are none.
const toWrite = [
  ...toA,
  ...(ALL_UPGRADES ? otherUp : []),
  ...(DOWNGRADES ? downgrades : []),
];

console.log(`\nRe-grade — ${leads.length.toLocaleString()} leads without a manual override`);
console.log('  stored today :', JSON.stringify(before));
console.log('  rules say    :', JSON.stringify(after));
console.log('\n  movements:');
for (const [k, v] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(14)} ${String(v).padStart(5)}`);
}
console.log(`\n  disagreements: ${diffs.length}`);
console.log(`    → A                  ${String(toA.length).padStart(5)}   ${'(writing)'}`);
console.log(`    other upgrades       ${String(otherUp.length).padStart(5)}   ${ALL_UPGRADES ? '(writing)' : '(needs --all-upgrades)'}`);
console.log(`    downgrades           ${String(downgrades.length).padStart(5)}   ${DOWNGRADES ? '(writing)' : '(needs --allow-downgrades)'}`);
console.log(`\n  this run would write: ${toWrite.length}`);

if (!APPLY) {
  console.log('\n  DRY RUN — nothing written. Re-run with --apply.\n');
  const sample = toA.slice(0, 15);
  if (sample.length) {
    console.log('  sample of leads that become A:');
    for (const r of sample) {
      console.log(`    ${String(r.id).padEnd(13)} ${r.from} → A   ${r.owner1LastName ?? ''}, ${r.addressStreet ?? ''} ${r.addressCity ?? ''}`);
    }
  }
  await pool.end();
  process.exit(0);
}

/**
 * Write each change in one transaction with its audit rows, so a lead can never end up
 * re-graded with no record of why. The activity mirrors what enrichment writes for a
 * system regrade ('grade_system', createdBy null = the rules acted, not a person), which
 * is the shape the QC Grade Changes report already reads.
 */
let written = 0, failed = 0;
for (const r of toWrite) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-read under the transaction: skip if a producer set an override, or the grade
    // moved, since the snapshot above was taken.
    const { rows: cur } = await client.query(
      `SELECT "grade","manualGrade" FROM "Lead" WHERE "id" = $1 FOR UPDATE`, [r.id],
    );
    if (!cur.length || cur[0].manualGrade || cur[0].grade !== r.from) {
      await client.query('ROLLBACK');
      continue;
    }
    await client.query(
      `UPDATE "Lead" SET "grade" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [r.id, r.to],
    );
    await client.query(
      `INSERT INTO "Activity" ("id","leadId","type","content","metadata","createdBy","createdAt")
       VALUES (gen_random_uuid()::text,$1,'grade_system',$2,$3,NULL,NOW())`,
      [
        r.id,
        `Grade ${r.from} → ${r.to} (re-graded by the rules)`,
        JSON.stringify({
          changes: [{ field: 'Grade', from: r.from, to: r.to }],
          via: 'scripts/regrade.mjs',
        }),
      ],
    );
    await client.query(
      `INSERT INTO "GradeChange" ("id","leadId","fromGrade","toGrade","source","reason","changedBy","changedAt")
       VALUES ($1,$2,$3,$4,'system',$5,$6,NOW())`,
      [
        crypto.randomUUID(), r.id, r.from, r.to,
        'Stored grade did not match the rules — re-graded by scripts/regrade.mjs',
        'system: regrade',
      ],
    );
    await client.query('COMMIT');
    written++;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    failed++;
    console.error(`  ! ${r.id}: ${err.message}`);
  } finally {
    client.release();
  }
}

console.log(`\n  wrote ${written}${failed ? `, ${failed} failed` : ''}${written !== toWrite.length ? `, ${toWrite.length - written - failed} skipped (changed underneath)` : ''}\n`);
await pool.end();
