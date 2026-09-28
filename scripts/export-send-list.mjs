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
 * -- band_low / band_high ship EMPTY -----------------------------------------
 * The two columns are present so Zoya can build the import mapping once (28 Sep) and not
 * rebuild it the day a real range exists. They carry no value today.
 *
 * The CRM does have lowPremium/highPremium on every rated account and they look like the
 * band the copy asks for. They are not: they are derived from expectedPremium, which a
 * machine produced. On 531 of the 540 rated accounts the producer's own rating falls BELOW
 * that band -- median a factor of 3.17, worst case a home a producer rated at $251 against a
 * band reading $6,891-$10,253.
 *
 * Frank, second email §5: "accounts are being marked rated that nobody rated -- and they
 * would receive a band price that doesn't exist."
 *
 * So the producer's actual number travels alongside, under its own name, and the band waits
 * for Frank to say where a RANGE is supposed to come from. Until he does, a campaign step
 * that merges band_low renders nothing rather than a number nobody quoted.
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
import { mergeVarsFor, agencyWebsite } from '@/services/mergeVars.service';
import { resolveInboxCollisions } from '@/services/inboxCollision.service';
import { subjectName, CTA_BY_STEP } from '@/services/campaignSegment.service';
import fs from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FROM = args[0] || '2026-10-05';
const TO = args[1] || '2026-11-16';
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice('--out='.length) : null;

const held = await heldAddresses();
// The same value the push reads, so an uploaded contact and a pushed one cannot disagree
// about whether the booking link exists.
const site = await agencyWebsite();
const leads = await sql`
  SELECT * FROM "Lead"
   WHERE "sendListBuiltAt" IS NOT NULL AND "cohort" BETWEEN ${FROM} AND ${TO}
   ORDER BY "cohort", "owner1LastName"`;

/** RFC-4180: quote everything, double any embedded quote. Names carry commas and apostrophes. */
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const COLUMNS = [
  // The header row is what the platform offers on the import screen, and for a column
  // mapped as a Custom Variable it becomes the variable name the template uses. So these
  // match Frank's copy exactly (Zoya, 28 Sep) — nothing has to be rewritten at either end.
  //
  // email, firstName and lastName are mapped to the platform's OWN types on import, so
  // their headers only have to be recognisable to a person; the variables they produce are
  // {{firstName}} and {{lastName}} whatever this says.
  'email', 'firstName', 'lastName', 'recipient_role',
  'segment', 'cohort', 'subject_variant', 'cta_arm',
  'street_address', 'street_name', 'town', 'state', 'zip',
  'renewal_date', 'month', 'meeting_link',
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
  'subject_1', 'subject_2', 'subject_3',
  'cta_1', 'cta_2', 'cta_3',
  'subject_name_1', 'cta_name_1', 'version_label_1',
  // Empty, and empty on purpose -- see the top of the file. Mapped now, filled later.
  'band_low', 'band_high',
  // The producer's own figure, under its own name. NOT a band and not a range.
  'producer_premium', 'premium_source',
  'lead_id', 'property_id',
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

    const v = mergeVarsFor(l, role, site);
    if (!v.firstName) continue;

    rows.push([
      email, v.firstName, v.lastName, role,
      v.segment, v.cohort, v.subject_variant, v.cta_arm,
      v.street_address, v.street_name, v.town, l.addressState ?? '', l.addressZip ?? '',
      v.renewal_date, v.month, v.meeting_link,
      v.subject_1, v.subject_2, v.subject_3,
      v.cta_1, v.cta_2, v.cta_3,
      subjectName({ segment: l.campaignSegment, cohort: String(l.cohort), step: 1, variant: v.subject_variant }),
      CTA_BY_STEP[1][Number(v.cta_arm)].name,
      v.version_label,
      /**
       * band_low and band_high ship as EMPTY columns, present so the mapping can be built
       * (Zoya, 28 Sep) and filled the moment a real range exists.
       *
       * The CRM does hold a low/high pair. It is derived from a machine estimate and sits a
       * median 3.2x above what the producer actually rated — on 531 of 540 rated accounts
       * the producer's own figure falls below it. Putting that in front of a homeowner is
       * exactly what Frank warned about, so the column is here and the value is not.
       */
      '', '',
      premium, premium === '' ? '' : (l.ratedSource ?? 'unrecorded'),
      l.id, l.propertyId ?? '',
    ]);
  }
}

/**
 * ── One inbox, one contact ──────────────────────────────────────────────────
 *
 * The platform keys a contact by EMAIL ADDRESS and every custom variable hangs off that
 * row. Two of our rows sharing an address are therefore not two contacts: the upload keeps
 * one, and which one is whichever the file happened to list last.
 *
 * That is how ramupedada@gmail.com would have been told about 3304 Expedition St while
 * holding the renewal date of 3303 — a perfectly delivered email describing the wrong
 * house. See inboxCollision.service for the rule; the loser is held for its own cohort
 * rather than dropped.
 */
const iEmail = COLUMNS.indexOf('email');
const iRenewal = COLUMNS.indexOf('renewal_date');
const iRole = COLUMNS.indexOf('recipient_role');
const iProp = COLUMNS.indexOf('property_id');
const iCohort = COLUMNS.indexOf('cohort');
const { keep, held: inboxHeld, collisions, needsDecision } = resolveInboxCollisions(rows, (r) => ({
  email: String(r[iEmail] ?? ''),
  renewalDate: String(r[iRenewal] ?? ''),
  role: String(r[iRole] ?? ''),
  propertyId: String(r[iProp] ?? ''),
  cohort: String(r[iCohort] ?? ''),
}));

const csv = [COLUMNS.map(esc).join(','), ...keep.map((r) => r.map(esc).join(','))].join('\r\n');

console.error(`${FROM} to ${TO}`);
console.error(`  ${leads.length} accounts on the send list`);
console.error(`  ${keep.length} contacts exported`);
console.error(`  ${heldOut} held by the surname review and NOT exported`);
if (collisions) {
  console.error(`  ${inboxHeld.length} held because ${collisions} inbox(es) are shared by more than one contact:`);
  for (const h of inboxHeld) {
    console.error(`     ! ${h.row[iEmail]} — ${h.row[8]} (renews ${h.row[iRenewal]})`);
    console.error(`       ${h.reason}`);
  }
}
const bySeg = new Map();
for (const r of keep) bySeg.set(r[4], (bySeg.get(r[4]) ?? 0) + 1);
for (const [k, v] of [...bySeg].sort()) console.error(`     ${k}: ${v}`);
const byC = new Map();
for (const r of keep) byC.set(r[5], (byC.get(r[5]) ?? 0) + 1);
console.error('  by cohort: ' + [...byC].sort().map(([k, v]) => `${k} ${v}`).join(' · '));
const withMeet = keep.filter((r) => r[15]).length;
console.error(`\n  band_low / band_high: columns present, EMPTY on all ${keep.length} rows.`);
console.error('  The CRM band is machine-derived and contradicts the producer rating on 98% of');
console.error('  accounts, so the value waits for Frank — see the header of this file.');
console.error(`  meeting_link: filled on ${withMeet} of ${keep.length} rows (needs agencyWebsite in AppConfig).`);

/**
 * Last, and loud, because it is the only line here that asks somebody for a decision
 * rather than telling them what happened.
 */
if (needsDecision.length) {
  console.error(`\n  !! ${needsDecision.length} propert${needsDecision.length === 1 ? 'y is' : 'ies are'} NOT mailed at all by this file.`);
  console.error('  Each shares an inbox with a different property, and the platform keeps ONE');
  console.error('  contact per address per upload — so whatever their cohort, this file does not');
  console.error('  reach them. A later cohort only helps if that wave is uploaded as its own');
  console.error('  campaign, which C4-C7 currently is not.');
  console.error('  Options: split the waves, use a different address for one house, or accept it.');
  console.error('  Frank picks — not the sort order.');
  for (const h of needsDecision) {
    console.error(`     ${h.row[iEmail]} — ${h.row[8]}, ${h.row[10]} (prop ${h.row[iProp]})`);
  }
}

if (OUT) {
  fs.writeFileSync(OUT, csv, 'utf8');
  console.error(`\nwritten to ${OUT}`);

  /**
   * The held rows go to their own file rather than nowhere.
   *
   * A contact that is on the send list and not in the upload is exactly the kind of thing
   * that gets noticed a quarter later, by which point nobody can say whether it was a rule
   * or a bug. This file is the answer to "where did they go", and it carries the reason on
   * every row.
   */
  if (inboxHeld.length) {
    const heldPath = OUT.replace(/\.csv$/i, '') + '.held-shared-inbox.csv';
    const heldCsv = [
      [...COLUMNS, 'held_because', 'mailed_instead'].map(esc).join(','),
      ...inboxHeld.map((h) => [...h.row, h.reason, h.keptInstead[iProp]].map(esc).join(',')),
    ].join('\r\n');
    fs.writeFileSync(heldPath, heldCsv, 'utf8');
    console.error(`${inboxHeld.length} held row(s) written to ${heldPath}`);
  }
} else console.log(csv);
