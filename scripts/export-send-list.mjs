/**
 * The send-list export for the email platform (Frank's directive · §6.1, §6.2).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/export-send-list.mjs 2026-10-26 2026-11-16
 *   node --import ./scripts/lib/register-ts.mjs scripts/export-send-list.mjs            # all of C1-C7
 *
 * Reads only. Writes a CSV to the path given by --out, or prints it.
 *
 * -- One row per PERSON, not per account ------------------------------------
 * The platform holds contacts, and §1.5 mails the insured and the co-insured separately with
 * their own subject line and CTA. An account with both contributes two rows carrying
 * different variants, which is the whole point of balancing per person.
 *
 * -- What is deliberately NOT in this file -----------------------------------
 * There is no band_low / band_high column.
 *
 * The CRM has lowPremium/highPremium populated on every rated account and they look like
 * the band the copy asks for. They are not: they are derived from expectedPremium, which a
 * machine produced. On 531 of the 540 rated accounts the producer's own rating falls BELOW
 * that band -- median a factor of 3.17, worst case a home a producer rated at $251 against a
 * band reading $6,891-$10,253.
 *
 * Frank, second email §5: "accounts are being marked rated that nobody rated -- and they
 * would receive a band price that doesn't exist."
 *
 * Shipping the column empty would be no safer than shipping it wrong: an empty column in a
 * file headed band_low is an invitation to fill it from the nearest plausible field. So the
 * producer's actual number travels instead, under its own name, and the band waits for
 * Frank to say where a RANGE is supposed to come from.
 *
 * -- Held addresses are excluded ---------------------------------------------
 * An address failing the surname check is not in this file at all (§7 of the second email:
 * "Failures go to a review list, not into a send"). It cannot be exported and then filtered
 * later by somebody who does not know to.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { bestInsuredAddress, bestCoInsuredAddress } from '@/services/addressRank.service';
import { heldAddresses } from '@/services/emailNameReview.service';
import { mergeVarsFor } from '@/services/mergeVars.service';
import { subjectName, CTA_BY_STEP } from '@/services/campaignSegment.service';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FROM = args[0] || '2026-10-05';
const TO = args[1] || '2026-11-16';
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : null;

const held = await heldAddresses();
const leads = await sql`
  SELECT * FROM "Lead"
   WHERE "sendListBuiltAt" IS NOT NULL AND "cohort" BETWEEN ${FROM} AND ${TO}
   ORDER BY "cohort", "owner1LastName"`;

/** RFC-4180: quote everything, double any embedded quote. Names carry commas and apostrophes. */
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const COLUMNS = [
  // The header row becomes the variable name on the platform, so these are spelled exactly
  // as the template must reference them: camelCase, the way Instantly names its own.
  'email', 'firstName', 'lastName', 'recipientRole',
  'segment', 'cohort', 'subjectVariant', 'ctaArm',
  'streetAddress', 'streetName', 'town', 'state', 'zip',
  'renewalDate', 'month',
  /**
   * The actual subject line and CTA wording for each step, fully resolved.
   *
   * §3: assignment is "Built in the CRM at list build and written to the lead record — NOT
   * in the email tool, whose randomiser will not balance across cohorts."
   *
   * So the platform must not choose. Given only a variant letter it would pick the wording
   * with its own A/B feature, and its randomiser would quietly replace the balanced
   * assignment with an unbalanced one — leaving the comparison the whole wave exists to
   * produce unreadable, while every report still called itself balanced.
   *
   * Carrying the literal text makes the platform a renderer. It has nothing left to decide,
   * so it cannot decide it differently.
   *
   * Blank at step 3 for C1–C3: the §2 calendar gives those weeks two emails, and copy sitting
   * in the platform for a send that is not scheduled is copy somebody will eventually send.
   */
  'subject1', 'subject2', 'subject3',
  'cta1', 'cta2', 'cta3',
  'subjectName1', 'ctaName1', 'versionLabel1',
  // The producer's own figure, under its own name. NOT a band and not a range.
  'producerPremium', 'premiumSource',
  'leadId', 'propertyId',
];

const rows = [];
let heldOut = 0;

/**
 * Every value comes from mergeVarsFor — the same function the push hands to the platform.
 *
 * This block used to build its own. It rebuilt the renewal date with `new Date(text)`, which
 * parses a bare 'YYYY-MM-DD' as UTC midnight; read back with local getters in a zone behind
 * UTC that is the day BEFORE. Every one of the 678 accounts carried a renewal date one day
 * early, in the sentence Frank's copy states as fact — and the 19 renewing on the 1st were
 * told the wrong month outright.
 *
 * Two places building the same values is what let that happen in one of them. There is now
 * one place.
 */
for (const l of leads) {
  const premium = l.travelersPremium ?? l.plymouthPremium ?? '';

  for (const [role, picked] of [
    ['insured', bestInsuredAddress(l)],
    ['coInsured', bestCoInsuredAddress(l)],
  ]) {
    const email = String(picked?.email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (held.has(email)) { heldOut++; continue; }

    const v = mergeVarsFor(l, role);
    if (!v.firstName) continue;

    rows.push([
      email, v.firstName, v.lastName, role,
      v.segment, v.cohort, v.subjectVariant, v.ctaArm,
      v.streetAddress, v.streetName, v.town, l.addressState ?? '', l.addressZip ?? '',
      v.renewalDate, v.month,
      v.subject1, v.subject2, v.subject3,
      v.cta1, v.cta2, v.cta3,
      subjectName({ segment: l.campaignSegment, cohort: String(l.cohort), step: 1, variant: v.subjectVariant }),
      CTA_BY_STEP[1][Number(v.ctaArm)].name,
      v.versionLabel,
      premium, premium === '' ? '' : (l.ratedSource ?? 'unrecorded'),
      l.id, l.propertyId ?? '',
    ]);
  }
}

const csv = [COLUMNS.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');

console.error(`${FROM} to ${TO}`);
console.error(`  ${leads.length} accounts on the send list`);
console.error(`  ${rows.length} contacts exported`);
console.error(`  ${heldOut} held by the surname review and NOT exported`);
const bySeg = new Map();
for (const r of rows) bySeg.set(r[4], (bySeg.get(r[4]) ?? 0) + 1);
for (const [k, v] of [...bySeg].sort()) console.error(`     ${k}: ${v}`);
const byC = new Map();
for (const r of rows) byC.set(r[5], (byC.get(r[5]) ?? 0) + 1);
console.error('  by cohort: ' + [...byC].sort().map(([k, v]) => `${k} ${v}`).join(' · '));
console.error('\n  NOTE: no band_low / band_high column. The CRM band is machine-derived and');
console.error('  contradicts the producer rating on 98% of accounts — see the header of this file.');

if (OUT) { fs.writeFileSync(OUT, csv, 'utf8'); console.error(`\nwritten to ${OUT}`); }
else console.log(csv);
