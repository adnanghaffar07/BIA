/**
 * Put one signature template on every sending mailbox (Frank's directive §5).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/apply-signatures.mjs \
 *        --template=signature.txt --values=producers.csv \
 *        --website=https://burlingtonai.com --office="123 Main St, Burlington NJ 08016"
 *
 *   ... --commit     write them (dry run otherwise)
 *   ... --audit      just report what every mailbox has today, and stop
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * §5: "Compliance is not optional. Postal address in the signature, opt-out line in the
 * signature." Both live ONLY in the signature, and 26 of 28 mailboxes have none at all.
 * That is the gate on every send, and it was going to be done by hand 28 times.
 *
 * ── The template ────────────────────────────────────────────────────────────
 * Plain text. Placeholders are the five the copy already uses:
 *
 *   {{ producer_name }}          taken from the mailbox itself
 *   {{ license_number }}         from the values file, per mailbox
 *   {{ producer_direct_phone }}  from the values file, per mailbox
 *   {{ agency_website }}         --website, same for all
 *   {{ office_address }}         --office, same for all
 *
 * ── The values file ─────────────────────────────────────────────────────────
 * A CSV with an email column, a licence column and a phone column, under any headings
 * containing those words. One row per producer.
 *
 * A mailbox with nothing supplied is REFUSED, not written with a blank. "NJ Producer
 * License #" followed by nothing is worse than no licence line: it goes out under a
 * producer's name and proves nobody checked.
 */
import './lib/env.mjs';
import fs from 'node:fs';
import { allSignatures, planSignatures, applySignatures } from '@/services/mailboxSignature.service';
import { parseCsv } from '@/services/verificationImport.service';

const args = process.argv.slice(2);
const arg = (k) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};
const COMMIT = args.includes('--commit');
const AUDIT = args.includes('--audit');

/** ── Audit mode: what is on the mailboxes right now ─────────────────────── */
if (AUDIT || (!arg('template') && !COMMIT)) {
  const all = await allSignatures();
  const compliant = all.filter((s) => !s.problems.length);
  console.log(`${all.length} sending mailboxes · ${compliant.length} compliant · ${all.length - compliant.length} not\n`);
  for (const s of all) {
    if (!s.problems.length) { console.log(`  OK   ${s.email}`); continue; }
    console.log(`  BAD  ${s.email}  (${s.name || 'no name on the account'})`);
    for (const p of s.problems) console.log(`         · ${p}`);
  }
  if (!arg('template')) {
    console.log('\nPass --template=<file> to plan a write. See the header of this file.');
  }
  process.exit(0);
}

/** ── Plan / apply ───────────────────────────────────────────────────────── */
const templatePath = arg('template');
if (!templatePath || !fs.existsSync(templatePath)) {
  console.error(`No template at ${templatePath}`);
  process.exit(2);
}
const template = fs.readFileSync(templatePath, 'utf8');

const perMailbox = new Map();
const valuesPath = arg('values');
if (valuesPath) {
  if (!fs.existsSync(valuesPath)) { console.error(`No values file at ${valuesPath}`); process.exit(2); }
  const rows = parseCsv(fs.readFileSync(valuesPath, 'utf8'));
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const eCol = col(/email|mailbox/);
  const lCol = col(/licen[cs]e|lic\b/);
  const pCol = col(/phone|direct/);
  if (eCol < 0) {
    console.error('No email column in the values file. Headings found:');
    rows[0].forEach((h, i) => console.error(`  [${i}] ${h}`));
    process.exit(2);
  }
  console.log(`values : email "${rows[0][eCol]}"`
    + ` · licence ${lCol >= 0 ? `"${rows[0][lCol]}"` : '(none)'}`
    + ` · phone ${pCol >= 0 ? `"${rows[0][pCol]}"` : '(none)'}`);
  for (const r of rows.slice(1)) {
    const email = String(r[eCol] ?? '').trim().toLowerCase();
    if (!email) continue;
    perMailbox.set(email, {
      licenseNumber: lCol >= 0 ? String(r[lCol] ?? '').trim() || null : null,
      directPhone: pCol >= 0 ? String(r[pCol] ?? '').trim() || null : null,
    });
  }
  console.log(`         ${perMailbox.size} producer row(s)\n`);
}

const values = {
  agencyWebsite: arg('website'),
  officeAddress: arg('office'),
  perMailbox,
};

const plans = await planSignatures(template, values);
const ready = plans.filter((p) => !p.missing.length && !p.problems.length);
const blocked = plans.filter((p) => p.missing.length || p.problems.length);

console.log(`${plans.length} mailboxes · ${ready.length} would be compliant · ${blocked.length} would NOT\n`);

if (ready.length) {
  console.log('example of what would be written:');
  console.log(ready[0].text.split('\n').map((l) => `    ${l}`).join('\n'));
  console.log();
}

if (blocked.length) {
  console.log('refused:');
  for (const b of blocked) {
    console.log(`  ${b.email}${b.name ? ` (${b.name})` : ''}`);
    for (const m of b.missing) console.log(`     · nothing supplied for ${m}`);
    for (const p of b.problems) console.log(`     · ${p}`);
  }
  console.log();
}

if (!COMMIT) {
  console.log('DRY RUN — nothing written. Re-run with --commit.\n');
  process.exit(0);
}

const { written, refused } = await applySignatures(template, values);
console.log(`written to ${written.length} mailbox(es)`);
if (refused.length) {
  console.log(`refused ${refused.length}:`);
  for (const r of refused) console.log(`  ${r.email} — ${r.why.join('; ')}`);
}

// Re-read every mailbox, so the final number is the vendor's answer and not ours.
const after = await allSignatures();
const ok = after.filter((s) => !s.problems.length).length;
console.log(`\n${ok} of ${after.length} mailboxes are now compliant`);
process.exit(ok === after.length ? 0 : 1);
