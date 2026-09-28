/**
 * Repair the variable names in a campaign's sequence copy.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/fix-campaign-sequence.mjs <campaignId>
 *   ... --commit     write it (default is a dry run)
 *
 * ── What this fixes ─────────────────────────────────────────────────────────
 * Names only. The platform does not validate merge variables, so copy asking for one that
 * does not exist renders NOTHING — no error, no bounce, no log line. The C4–C7 sequence
 * referenced nine variables and eight of them did not exist, so the email would have opened
 * "Hi ," and ended with a blank signature.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 * It does not write marketing copy. The body currently in both steps is Frank's EMAIL 3
 * ("Last note from me on this one… no more emails from me"), and emails 1 and 2 exist
 * nowhere in this repo. Inventing them would put words in a producer's mouth, under his
 * licence number, to a homeowner. The step bodies are therefore left as they are and the
 * gap is reported.
 *
 * It also does not touch the signature block. Those five names cannot be contact variables
 * at all: the platform chooses which of 28 mailboxes sends at send time, so a signature
 * carried on the CONTACT would name the wrong producer most of the time. That needs a
 * decision about per-mailbox campaigns, not a rename.
 *
 * Backs the original up first. The platform keeps no version history.
 */
import './lib/env.mjs';
import fs from 'node:fs';
import { getCampaign, patchCampaign } from '@/lib/integrations/leadCampaign';
import { unknownTokensIn, blockedTokensIn, tokensIn } from '@/lib/mergeFields';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const campaignId = args.find((a) => !a.startsWith('--'));
if (!campaignId) { console.error('Usage: fix-campaign-sequence.mjs <campaignId> [--commit]'); process.exit(2); }

const full = await getCampaign(campaignId);
if (Number(full.status) === 1) {
  console.error(`\n${full.name} is ACTIVE. Rewriting copy under a running sequence would change`);
  console.error('what later steps say mid-conversation. Pause it, re-run, then resume.');
  process.exit(3);
}

const steps = full.sequences?.[0]?.steps ?? [];
if (!steps.length) { console.error('That campaign has no sequence steps.'); process.exit(2); }

console.log(`\n${full.name}  ·  status ${full.status}  ·  ${steps.length} steps`);

// ── Back up before anything ─────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `backups/sequence-${campaignId}-${stamp}.json`;
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(backup, JSON.stringify(full.sequences, null, 2), 'utf8');
console.log(`original sequence backed up to ${backup}`);

/**
 * The renames. Spacing inside the braces is ignored on the way in — Frank's copy writes
 * both {{month}} and {{ first_name }} — and normalised on the way out.
 */
const RENAMES = [
  [/\{\{\s*first_name\s*\}\}/g, '{{firstName}}'],
  [/\{\{\s*last_name\s*\}\}/g, '{{lastName}}'],
  [/\{\{\s*renewalDate\s*\}\}/g, '{{renewal_date}}'],
  [/\{\{\s*streetAddress\s*\}\}/g, '{{street_address}}'],
  [/\{\{\s*streetName\s*\}\}/g, '{{street_name}}'],
  [/\{\{\s*month\s*\}\}/g, '{{month}}'],
  /**
   * The booking line becomes the finished URL rather than two fragments the platform has to
   * join. {{ agency_website }} is not a variable we produce, so "{{ agency_website }}/meet"
   * renders as "/meet" at best and prints the braces at worst; {{meeting_link}} is real and
   * fills itself the moment Frank supplies the website.
   */
  [/\{\{\s*agency_website\s*\}\}\/meet/g, '{{meeting_link}}'],
];

const applyStep = (body, step) => {
  let out = String(body ?? '');
  for (const [re, to] of RENAMES) out = out.replace(re, to);
  // The CTA is per STEP. Both steps carried {{cta1}}, so step 2 asked for step 1's ask.
  out = out.replace(/\{\{\s*cta1\s*\}\}/g, `{{cta_${step}}}`);
  out = out.replace(/\{\{\s*cta2\s*\}\}/g, `{{cta_${step}}}`);
  out = out.replace(/\{\{\s*cta3\s*\}\}/g, `{{cta_${step}}}`);
  return out;
};

/**
 * Step 2's stored HTML wraps every line in its own <div>, splitting sentences mid-clause
 * ("if a second opinion</div><div>is worth anything"). Step 1 holds the same text cleanly.
 * Since the two bodies ARE the same copy, step 2 is rebuilt from step 1 rather than
 * untangled — same words, in the form Frank actually wrote them, and it drops the stray
 * second {{cta1}} that had been pasted after the opt-out line.
 */
const cleanBase = String(steps[0].variants?.[0]?.body ?? '');

const next = steps.map((s, i) => {
  const stepNo = i + 1;
  /**
   * What this step's words are, beyond step 1's.
   *
   * Reported as the actual extra text rather than a bare "they differ", because the answer
   * decides whether rebuilding is safe. Here it is a stray "{{cta1}}" pasted after the
   * opt-out line and nothing else — the first 958 characters are identical. If a future run
   * finds a real paragraph here, that is copy about to be thrown away and the run should
   * stop rather than print a warning somebody scrolls past.
   */
  const mine = stripHtml(String(s.variants?.[0]?.body ?? ''));
  const base = stripHtml(cleanBase);
  const extra = i === 0 ? '' : (mine.startsWith(base) ? mine.slice(base.length).trim() : mine);
  return {
    // Step 1 sends immediately. Step 2 carried a delay of 0, which would have sent a second
    // email the same day; 3 days is the editor's own default and Frank's calendar governs.
    delay: stepNo === 1 ? 0 : (Number(s.delay) > 0 ? Number(s.delay) : 3),
    subject: `{{subject_${stepNo}}}`,
    body: applyStep(i === 0 ? cleanBase : cleanBase, stepNo),
    rebuiltFromStep1: i > 0,
    extra,
  };
});

function stripHtml(h) {
  return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Report ──────────────────────────────────────────────────────────────────
let stillBroken = [];
for (let i = 0; i < next.length; i++) {
  const s = next[i];
  const before = steps[i].variants?.[0] ?? {};
  const bad = [...new Set([...unknownTokensIn(s.subject), ...unknownTokensIn(s.body)])];
  const blocked = [...new Set(blockedTokensIn(s.body).map((f) => f.name))];
  stillBroken = [...new Set([...stillBroken, ...bad])];

  console.log(`\n─── step ${i + 1} ───`);
  console.log(`  subject  was ${JSON.stringify(String(before.subject ?? ''))}`);
  console.log(`           now ${JSON.stringify(s.subject)}`);
  console.log(`  delay    was ${steps[i].delay ?? 0} -> ${s.delay}`);
  if (s.rebuiltFromStep1) {
    console.log(`  body     rebuilt from step 1's clean HTML`);
    console.log(s.extra
      ? `           this step also held, and this is being DROPPED: ${JSON.stringify(s.extra)}`
      : `           (it held exactly the same words)`);
  }
  console.log(`  variables now used: ${tokensIn(s.body).filter((v, n, a) => a.indexOf(v) === n).join(', ')}`);
  console.log(`  still do not exist: ${bad.length ? bad.join(', ') : 'none'}`);
  console.log(`  real but empty    : ${blocked.length ? blocked.join(', ') : 'none'}`);
}

if (stillBroken.length) {
  console.log(`\n!! ${stillBroken.length} variable(s) STILL do not exist after this fix:`);
  console.log(`   ${stillBroken.join(', ')}`);
  console.log('   These are the signature. They cannot be contact variables — the platform picks');
  console.log('   which of 28 mailboxes sends at send time, so a signature carried on the contact');
  console.log('   would name the wrong producer. It needs one campaign per mailbox, or literal');
  console.log('   text. Either way it is a decision, not a rename.');
}

console.log('\n!! The BODY of every step is Frank\'s EMAIL 3 ("Last note from me on this one").');
console.log('   Emails 1 and 2 do not exist in this repo and are not written here.');
console.log('   Fixing the names makes it render; it does not make it the right email to open with.');

/**
 * A stray "{{cta1}}" is a paste accident and dropping it is the fix. A sentence is not, and
 * this script must never be the reason a line of Frank's copy quietly disappears.
 */
const losing = next.filter((s) => s.extra && !/^(\{\{[^}]*\}\})+$/.test(s.extra.replace(/\s+/g, '')));
if (losing.length) {
  console.log('\n!! REFUSING TO WRITE — rebuilding would discard real text:');
  for (const s of losing) console.log(`   ${JSON.stringify(s.extra)}`);
  console.log('   The backup holds the original. Sort the copy out first.');
  process.exit(4);
}

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit.\n');
  process.exit(0);
}

await patchCampaign(campaignId, {
  sequences: [{
    steps: next.map((s) => ({
      type: 'email',
      delay: s.delay,
      variants: [{ subject: s.subject, body: s.body }],
    })),
  }],
});
console.log('\nwritten. re-reading to confirm…');

const after = await getCampaign(campaignId);
const afterSteps = after.sequences?.[0]?.steps ?? [];
for (let i = 0; i < afterSteps.length; i++) {
  const v = afterSteps[i].variants?.[0] ?? {};
  const bad = [...new Set([...unknownTokensIn(String(v.subject ?? '')), ...unknownTokensIn(String(v.body ?? ''))])];
  console.log(`  step ${i + 1}: subject ${JSON.stringify(v.subject)} · non-existent variables: ${bad.length ? bad.join(', ') : 'none'}`);
}
