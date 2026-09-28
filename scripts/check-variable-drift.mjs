/**
 * What the sending platform holds, against what the CRM says today.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/check-variable-drift.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/check-variable-drift.mjs <campaignId>
 *   ... --verbose        list every contact, not just the first few
 *   ... --out=drift.csv  one row per wrong variable, for working through
 *
 * Reads only. Writes nothing to the platform and nothing to the CRM.
 *
 * ── Why this has to be run rather than trusted ──────────────────────────────
 * A contact's merge variables are frozen when it is created. The card behind it is not: a
 * renewal date gets corrected, a lead gets rated, the band prices arrive. None of that
 * reaches the platform, and none of it fails in a way anybody can see — a variable the
 * template asks for and the contact does not carry renders as nothing at all.
 *
 * Exit code is 1 when anything is wrong, so this can gate a send.
 */
import './lib/env.mjs';
import fs from 'node:fs';
import { listCampaigns } from '@/lib/integrations/leadCampaign';
import { checkCampaignDrift } from '@/services/variableDrift.service';

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const outArg = args.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : null;
const wanted = args.find((a) => !a.startsWith('--')) ?? null;

const campaigns = await listCampaigns();
const targets = wanted
  ? campaigns.filter((c) => c.id === wanted || c.name === wanted)
  : campaigns;

if (!targets.length) {
  console.error(`No campaign matched ${wanted}. Known campaigns:`);
  for (const c of campaigns) console.error(`  ${c.id}  ${c.name}`);
  process.exit(2);
}

const csvRows = [];
let anyDrift = false;

for (const c of targets) {
  const r = await checkCampaignDrift(c.id);

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`${r.campaignName}`);
  console.log(`${'═'.repeat(78)}`);
  console.log(`  ${r.contacts} contacts on the platform`);
  console.log(`  ${r.matched} tied back to a CRM card · ${r.unmatched.length} could NOT be`);
  console.log(`  ${r.correct} carry every value a template will read · ${r.contacts - r.correct} do not`);
  console.log(`  ${r.clean} have nothing at all to report (no inert leftovers either)`);

  if (!r.contacts) { console.log('\n  nothing to check.'); continue; }

  /**
   * Orphans do NOT fail this. Nothing can read them, so a campaign carrying 5,265 of them
   * is as safe to send as one carrying none — and gating on them would mean this check went
   * red forever after a successful repair, which is the fastest way to teach somebody to
   * ignore it.
   */
  if (r.byKind.missing || r.byKind.stale || r.unmatched.length) anyDrift = true;

  console.log(`\n  by kind:`);
  console.log(`    missing  ${String(r.byKind.missing).padStart(5)}  the CRM has a value, the contact does not — renders BLANK`);
  console.log(`    stale    ${String(r.byKind.stale).padStart(5)}  both have one and they disagree — renders the OLD value`);
  console.log(`    orphan   ${String(r.byKind.orphan).padStart(5)}  a name we do not produce — nothing will ever reference it`);
  if (r.waiting.length) {
    console.log(`
  agreeing on nothing — the platform matches the CRM, and both are empty:`);
    for (const w of r.waiting) {
      console.log(`    ${w.name.padEnd(20)} ${String(w.contacts).padStart(5)} contacts — ${w.reason}`);
    }
  }

  if (r.byVariable.length) {
    console.log(`\n  by variable:`);
    console.log(`    ${'name'.padEnd(20)} ${'missing'.padStart(8)} ${'stale'.padStart(7)} ${'orphan'.padStart(7)}`);
    for (const v of r.byVariable) {
      console.log(`    ${v.name.padEnd(20)} ${String(v.missing).padStart(8)} ${String(v.stale).padStart(7)} ${String(v.orphan).padStart(7)}`);
    }
  }

  if (r.unmatched.length) {
    console.log(`\n  !! ${r.unmatched.length} contact(s) have NO OutreachEvent row behind them.`);
    console.log(`     Their replies, bounces and unsubscribes match against nothing and are dropped.`);
    for (const u of r.unmatched.slice(0, VERBOSE ? r.unmatched.length : 5)) {
      console.log(`       ${u.email}  (vendor id ${u.vendorLeadId})`);
    }
    if (!VERBOSE && r.unmatched.length > 5) console.log(`       … and ${r.unmatched.length - 5} more (--verbose)`);
  }

  if (r.drifted.length) {
    const show = VERBOSE ? r.drifted : r.drifted.slice(0, 3);
    console.log(`\n  examples:`);
    for (const d of show) {
      console.log(`\n    ${d.email}  ·  ${d.cohort ?? '?'}  ·  property ${d.propertyId ?? '?'}`);
      for (const v of d.diffs) {
        const a = v.actual === '' ? '(nothing)' : JSON.stringify(v.actual);
        const e = v.expected === '' ? '(nothing)' : JSON.stringify(v.expected);
        console.log(`        ${v.kind.padEnd(7)} ${v.name.padEnd(18)} platform ${a}`);
        if (v.kind !== 'orphan') console.log(`        ${' '.repeat(7)} ${' '.repeat(18)} CRM      ${e}`);
      }
    }
    if (!VERBOSE && r.drifted.length > show.length) {
      console.log(`\n    … and ${r.drifted.length - show.length} more contacts (--verbose)`);
    }
  }

  for (const d of r.drifted) {
    for (const v of d.diffs) {
      csvRows.push([c.name, d.email, d.propertyId ?? '', d.cohort ?? '', d.role ?? '', v.name, v.kind, v.actual, v.expected]);
    }
  }
}

if (OUT) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['campaign', 'email', 'property_id', 'cohort', 'role', 'variable', 'problem', 'on_platform', 'in_crm'];
  fs.writeFileSync(OUT, [header, ...csvRows].map((r) => r.map(esc).join(',')).join('\r\n'), 'utf8');
  console.log(`\n${csvRows.length} row(s) written to ${OUT}`);
}

console.log(`\n${anyDrift ? 'DRIFT FOUND — values a template reads are wrong' : 'no drift — every value a template reads is right'}\n`);
process.exit(anyDrift ? 1 : 0);
