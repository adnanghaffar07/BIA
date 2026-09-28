/**
 * Repair the merge variables on contacts that have drifted from their card.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/resync-variables.mjs <campaignId> --dry-run
 *   node --import ./scripts/lib/register-ts.mjs scripts/resync-variables.mjs <campaignId> --commit
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 * Only the variables that are MISSING or STALE, per contact. Nothing else.
 *
 * A partial PATCH merges on this vendor (probed 28 Sep, by writing and reading back), so
 * sending three keys cannot disturb the seventeen beside them. That is what makes a targeted
 * repair safe and why this does not simply overwrite the whole map.
 *
 * Orphans are left alone. `renewalDate`, `City / ZIP` and the rest are inert — no template
 * references them, so deleting them would be risk taken for tidiness. They also stay as
 * evidence of which upload a contact came from.
 *
 * ── Why it is not a fire-and-forget loop ────────────────────────────────────
 * This vendor returns 200 for a PATCH carrying a key it does not recognise. A re-sync that
 * trusted the status code would report 378 successes and change nothing, and the first
 * person to notice would be a homeowner reading an email with holes in it. Every contact is
 * therefore read back and compared after its write, and anything that did not take is
 * listed by name at the end.
 *
 * Deleting and re-adding these contacts would also have worked, and would have restarted
 * every one of their sequences at step 1.
 */
import './lib/env.mjs';
import { listCampaigns, updateLeadVariables } from '@/lib/integrations/leadCampaign';
import { checkCampaignDrift } from '@/services/variableDrift.service';

const args = process.argv.slice(2);
const DRY = !args.includes('--commit');
const campaignId = args.find((a) => !a.startsWith('--'));

if (!campaignId) {
  console.error('Usage: resync-variables.mjs <campaignId> [--dry-run | --commit]');
  process.exit(2);
}

const campaigns = await listCampaigns();
const campaign = campaigns.find((c) => c.id === campaignId);
if (!campaign) {
  console.error(`No campaign ${campaignId}. Known:`);
  for (const c of campaigns) console.error(`  ${c.id}  status=${c.status}  ${c.name}`);
  process.exit(2);
}

/**
 * Status 1 is actively sending. Rewriting a contact's variables mid-sequence means the next
 * step renders from values that were not the ones the earlier steps used, which is a worse
 * problem than the one being fixed — so it is refused rather than warned about.
 */
if (Number(campaign.status) === 1) {
  console.error(`\n${campaign.name} is ACTIVE and sending.`);
  console.error('Refusing to rewrite variables underneath a running sequence.');
  console.error('Pause the campaign, re-run this, then resume.');
  process.exit(3);
}

console.log(`\n${campaign.name}`);
console.log(`status=${campaign.status} (not sending)`);
console.log(DRY ? 'DRY RUN — nothing will be written\n' : 'COMMITTING — this writes to live contacts\n');

const report = await checkCampaignDrift(campaignId);
console.log(`${report.contacts} contacts · ${report.contacts - report.correct} need repair · ${report.correct} already correct`);

if (report.unmatched.length) {
  console.log(`${report.unmatched.length} cannot be tied to a card and will be SKIPPED — they have no source of truth.`);
}

// Only missing and stale are repairable. An orphan has no CRM value to write.
const work = report.drifted
  .map((d) => ({
    ...d,
    fixes: Object.fromEntries(
      d.diffs.filter((v) => v.kind !== 'orphan').map((v) => [v.name, v.expected]),
    ),
  }))
  .filter((d) => Object.keys(d.fixes).length);

const totalVars = work.reduce((n, d) => n + Object.keys(d.fixes).length, 0);
console.log(`\n${work.length} contacts to patch · ${totalVars} variables in total`);

if (DRY) {
  const sample = work.slice(0, 3);
  for (const d of sample) {
    console.log(`\n  ${d.email}  ·  property ${d.propertyId}  ·  ${d.cohort}`);
    for (const [k, v] of Object.entries(d.fixes)) {
      console.log(`      ${k.padEnd(18)} -> ${JSON.stringify(v)}`);
    }
  }
  if (work.length > sample.length) console.log(`\n  … and ${work.length - sample.length} more contacts`);
  console.log('\nRe-run with --commit to write these.\n');
  process.exit(0);
}

// ── Commit ──────────────────────────────────────────────────────────────────
let ok = 0;
let failed = 0;
const problems = [];
const started = Date.now();

for (let i = 0; i < work.length; i++) {
  const d = work[i];
  try {
    // updateLeadVariables reads the contact back and compares — the 200 is not the check.
    const res = await updateLeadVariables(d.vendorLeadId, d.fixes);
    if (res.ok) ok++;
    else {
      failed++;
      problems.push(`${d.email} — did not take: ${res.mismatched.join(', ')}`);
    }
  } catch (err) {
    failed++;
    problems.push(`${d.email} — ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
  }

  if ((i + 1) % 25 === 0 || i === work.length - 1) {
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`  ${i + 1}/${work.length}  ok=${ok} failed=${failed}  (${secs}s)`);
  }

  // One call per contact plus its read-back, paced the same as the push.
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\n${ok} repaired · ${failed} did not take`);
if (problems.length) {
  console.log('\nnot repaired:');
  for (const p of problems.slice(0, 25)) console.log(`  ${p}`);
  if (problems.length > 25) console.log(`  … and ${problems.length - 25} more`);
}

// ── Prove it, rather than assert it ─────────────────────────────────────────
console.log('\nre-checking from scratch…');
const after = await checkCampaignDrift(campaignId);
console.log(`  ${after.correct}/${after.contacts} contacts now carry every value a template will read`);
console.log(`  missing ${after.byKind.missing} · stale ${after.byKind.stale} · orphan ${after.byKind.orphan}`);
process.exit(after.byKind.missing + after.byKind.stale > 0 ? 1 : 0);
