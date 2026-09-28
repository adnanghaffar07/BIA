/**
 * Re-cut the wave-one send list, once, before anything sends.
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/recut-send-list.mjs
 *   node --import ./scripts/lib/register-ts.mjs scripts/recut-send-list.mjs --write
 *
 * -- Why this exists, and why it must never become routine ------------------
 * The list frozen on 24 Sep 2026 promised 850 accounts. The push would have delivered 716:
 *
 *   85  flagged holdout -- which Frank's section 1.9 says should not exist in wave one
 *   53  with no email address of any kind
 *    1  already suppressed
 *
 * Those accounts were also dealt subject and CTA arms. Every one the push refuses leaves a
 * hole in that deal, so the arms were balanced to within one person across the frozen list
 * and off by as much as eleven in what would actually have gone out -- a report that would
 * have described itself as balanced and meant it.
 *
 * -- The guard ---------------------------------------------------------------
 * This REFUSES to run once anything has sent. Fix 19 exists so a cohort's population cannot
 * change after it has been counted and mailed against; re-cutting after a send is precisely
 * the thing that forbids. Before the first send the freeze is protecting a population we
 * already know is wrong, and correcting it costs nothing. One minute after, it costs the
 * ability to explain any number.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { buildSendList } from '@/services/campaignSegment.service';
import { sendPreflight } from '@/services/sendPreflight.service';

const WRITE = process.argv.includes('--write');
const FROM = '2026-10-05';
const TO = '2026-11-16';

/**
 * ── Two guards, for two different kinds of damage ──────────────────────────
 *
 * This used to refuse whenever ANY OutreachEvent row existed, while computing
 * `actually_sent` and then not using it. The message said the population "has already been
 * mailed against" — which was false: 564 rows existed and none of them had ever sent.
 *
 * That matters because the stated reason was the wrong one, and a wrong reason invites
 * somebody to relax the check. The real risks are separate:
 *
 *   1. Something has SENT. Fix 19: a cohort's population must not change after it has been
 *      counted and mailed against, or no figure afterwards can be explained.
 *
 *   2. Contacts are LIVE ON THE PLATFORM holding a dealt subject variant and CTA arm. This
 *      script clears and re-deals those, so re-cutting would leave 378 uploaded contacts
 *      carrying a version_label that no longer describes the email they would receive — and
 *      it would silently rebalance cohorts that have already been counted.
 *
 * The second is the one that applies today, and the first check would never have caught it.
 */
const [sent] = await sql`
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE "sentAt" IS NOT NULL)::int AS actually_sent,
         COUNT(*) FILTER (WHERE "vendorLeadId" IS NOT NULL)::int AS on_platform
    FROM "OutreachEvent"`;

if (Number(sent.actually_sent) > 0) {
  console.error(`REFUSING: ${sent.actually_sent} outreach event(s) have actually sent.`);
  console.error('The send list freezes when it is built and must not change after a send —');
  console.error('that is the whole of fix 19. Re-cutting now would rewrite a population that');
  console.error('has already been mailed against, and no figure afterwards could be explained.');
  process.exit(1);
}

if (Number(sent.on_platform) > 0) {
  console.error(`REFUSING: ${sent.on_platform} contact(s) are live on the sending platform.`);
  console.error('Nothing has sent, so fix 19 is satisfied — but this script CLEARS the subject');
  console.error('variant and CTA arm and deals them again. Those contacts already hold the old');
  console.error('deal as merge variables, so re-dealing would leave each of them carrying a');
  console.error('version_label that describes an email they will not receive.');
  console.error('');
  console.error('To pick up newly rated or newly reachable accounts WITHOUT re-dealing, run a');
  console.error('plain build instead — buildSendList only fills assignments that are NULL:');
  console.error('  node --import ./scripts/lib/register-ts.mjs scripts/build-send-list.mjs --write');
  process.exit(1);
}

console.log(`nothing has sent and nothing is on the platform (${sent.n} rows registered) — safe to re-cut\n`);

console.log('=== before ===');
const before = await sendPreflight({ effFrom: FROM, effTo: TO });
console.log(`${before.onList} on the list · ${before.willSend} would send · ${before.refused} refused`);
for (const i of before.issues) console.log(`  [${i.severity}] ${i.headline}`);

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Re-run with --write.');
  process.exit(0);
}

/**
 * Cleared, not patched.
 *
 * The arms have to be dealt again from scratch over the new population. Removing the
 * refused accounts and keeping everyone else's arm would leave exactly the holes this is
 * meant to close — the remaining split would be whatever the old deal happened to leave.
 */
const cleared = await sql`
  UPDATE "Lead"
     SET "campaignSegment" = NULL, "campaignSegmentAt" = NULL, "sendListBuiltAt" = NULL,
         "insuredSubjectVariant" = NULL, "insuredCtaArm" = NULL,
         "coInsuredSubjectVariant" = NULL, "coInsuredCtaArm" = NULL,
         "updatedAt" = NOW()
   WHERE "cohort" BETWEEN ${FROM} AND ${TO}
     AND "sendListBuiltAt" IS NOT NULL
  RETURNING "id"`;
console.log(`\ncleared ${cleared.length} previous assignment(s)`);

const built = await buildSendList({ effFrom: FROM, effTo: TO, dryRun: false });
console.log(`\nrebuilt: ${built.cohorts} cohorts · ${built.leads} on the list · ${built.peopleAssigned} people`);
console.log(`   rated ${built.bySegment.rated} · not rated ${built.bySegment.unrated} · grade B ${built.bySegment.grade_b}`);
console.log(`   left off as unsendable: ${built.notSendable}`);
for (const c of built.notSendableByCohort) console.log(`      ${c.cohort}  ${c.n}`);

console.log('\nbalance as dealt:');
for (const b of built.balance) {
  console.log(`   ${b.cohort}  subject ${b.subjectA}/${b.subjectB}  ·  CTA ${b.arm1}/${b.arm2}`);
}

console.log('\n=== after ===');
const after = await sendPreflight({ effFrom: FROM, effTo: TO });
console.log(`${after.onList} on the list · ${after.willSend} would send · ${after.refused} refused`);
if (!after.issues.length) {
  console.log('  no issues — the list and the push agree');
} else {
  for (const i of after.issues) console.log(`  [${i.severity}] ${i.headline}`);
}
console.log(`\nok to send: ${after.ok}`);
