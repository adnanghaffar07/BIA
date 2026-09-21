/**
 * Migration runner for files containing MORE THAN ONE statement.
 *
 * Usage:  node scripts/run-migration-multi.mjs migrations/<file>.sql
 *
 * ── Why this exists alongside run-migration.mjs ─────────────────────────────
 * The original runner sends the file as one query and says so in its own header:
 * "each migration file should be a single statement". That held while a migration was one
 * ALTER TABLE with several ADD COLUMN clauses. It stopped holding at 026 — every migration
 * since creates a table AND its indexes, or alters two tables, and those cannot travel in
 * one statement over the driver's prepared-statement path.
 *
 * This existed for a while as scripts/lib/_mig2.mjs, which looked like scratch and was
 * doing the real work. That is a trap: the documented runner cannot run the current
 * migrations, and the one that can was named to be ignored. Renamed rather than deleted.
 *
 * ── How it splits ───────────────────────────────────────────────────────────
 * On a semicolon at end of line, with comment-only lines stripped from each fragment.
 * Deliberately simple, and it has a limit worth knowing: a semicolon inside a string
 * literal or a function body (a DO block, a trigger) would split in the wrong place. No
 * migration here has needed one. If one does, it should be run by hand rather than by
 * making this cleverer — a splitter that is nearly right is worse than none.
 *
 * Statements run in order, on one connection, and are NOT wrapped in a transaction:
 * CREATE INDEX CONCURRENTLY cannot run inside one, and a partial failure is easier to
 * reason about when each statement's success is printed as it goes.
 */
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-migration-multi.mjs migrations/<file>.sql');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — scripts/lib/env.mjs reads .env and .env.local.');
  process.exit(1);
}

const statements = readFileSync(file, 'utf8')
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);

console.log(`${file} — ${statements.length} statement(s)`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
let ran = 0;
try {
  for (const s of statements) {
    await client.query(s);
    ran++;
    console.log('  ok:', s.split('\n')[0].slice(0, 70));
  }
  console.log(`done — ${ran}/${statements.length} applied.`);
} catch (err) {
  // Named loudly: the statements before this one HAVE been applied, so a blind re-run is
  // only safe because every migration here is written with IF NOT EXISTS.
  console.error(`\nFAILED on statement ${ran + 1} of ${statements.length}.`);
  console.error(`Statements 1–${ran} were applied and are still in place.`);
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
