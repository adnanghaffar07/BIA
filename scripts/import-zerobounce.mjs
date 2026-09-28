/**
 * Import ZeroBounce results from the command line (Frank, 25 Sep 2026).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/import-zerobounce.mjs <file.csv>
 *   ... --label="9/25 insured #1"   names the batch, so a re-check is distinguishable
 *   ... --commit                    write it (dry run otherwise)
 *
 * There is also a screen — Verification in the sidebar — which most people should use.
 * This exists for files too large to post, and for running one from a terminal.
 *
 * ── Both read the file through the same service ─────────────────────────────
 * The parsing, the column detection and the attribution live in
 * verificationImport.service. Written twice they would eventually disagree about which
 * column is the status, and the only evidence would be two different numbers for one file.
 */
import './lib/env.mjs';
import fs from 'node:fs';
import { sql } from '@/lib/neon';
import { planVerificationImport, applyVerificationImport } from '@/services/verificationImport.service';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const labelArg = args.find((a) => a.startsWith('--label='));
const LABEL = labelArg ? labelArg.slice('--label='.length) : null;
const file = args.find((a) => !a.startsWith('--'));

if (!file || !fs.existsSync(file)) {
  console.error('Usage: import-zerobounce.mjs <file.csv> [--label="9/25 insured #1"] [--commit]');
  process.exit(2);
}

const plan = await planVerificationImport(fs.readFileSync(file, 'utf8'));

if (plan.error) {
  console.error(`\n${plan.error}`);
  if (plan.headers.length) {
    console.error('Headings found:');
    plan.headers.forEach((h, i) => console.error(`  [${i}] ${h}`));
  }
  process.exit(2);
}

console.log(`file    : ${file}`);
console.log(`email   : column [${plan.emailCol}] "${plan.headers[plan.emailCol]}"`);
console.log(`status  : column [${plan.statusCol}] "${plan.headers[plan.statusCol]}"`);
console.log(`sub     : ${plan.subCol >= 0 ? `column [${plan.subCol}] "${plan.headers[plan.subCol]}"` : '(none)'}`);
console.log(`label   : ${LABEL ?? '(none)'}`);
console.log(`mode    : ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

console.log(`${plan.rows.length} verdict(s) to import`);
console.log(`  data rows in file           : ${plan.counts.dataRows}`);
console.log(`  blank rows skipped          : ${plan.counts.blank}`);
console.log(`  duplicate addresses in file : ${plan.counts.duplicates}`);
console.log(`  addresses we do not hold    : ${plan.counts.unknownAddress}  (recorded anyway — a later trace may bring them in)`);

console.log(`\nby status:`);
for (const s of plan.byStatus) {
  console.log(`  ${s.status.padEnd(14)} ${String(s.n).padStart(5)}${s.deliverable ? '   <- counts as deliverable' : ''}`);
}
console.log(`\n${plan.counts.deliverable} of ${plan.rows.length} are deliverable (only "valid" counts — see the service)`);

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.\n');
  process.exit(0);
}

const imported = await applyVerificationImport(plan, { label: LABEL, source: 'zerobounce' });
console.log(`\nimported ${imported}`);

const [after] = await sql`
  SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "deliverable")::int AS ok
    FROM "EmailVerification"`;
console.log(`EmailVerification now holds ${after.n} verdict(s), ${after.ok} deliverable`);
