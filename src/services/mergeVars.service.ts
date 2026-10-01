import { sql } from '@/lib/neon';
import { subjectFor, stepsFor, versionLabel, CTA_BY_STEP, GRADE_B_CTA, SEGMENT_LABEL, type Segment } from './campaignSegment.service';
import { cohortCode, cohortNumber } from './cohort';

/**
 * The merge variables one person receives, built in ONE place.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * There are two ways a contact reaches the sending platform and they were building different
 * variable sets.
 *
 *   - campaignPush sends five: crm_property_id, property_address, renewal_date, band_low,
 *     band_high. It also writes the OutreachEvent row that every inbound reply, bounce and
 *     unsubscribe is matched on.
 *   - The CSV export sends nineteen, including the resolved subject line and CTA wording for
 *     each step — and writes no OutreachEvent at all.
 *
 * So one path renders the email correctly and loses every response; the other routes
 * responses and renders half the email blank. Neither is wrong on its own terms, and nothing
 * anywhere compares them.
 *
 * ── Why the subject and CTA text travel with the contact ────────────────────
 * §3: assignment is "Built in the CRM at list build and written to the lead record — not in
 * the email tool, whose randomiser will not balance across cohorts." Handing the platform a
 * variant LETTER and letting it choose the wording gives it the decision back. Handing it the
 * finished sentence leaves it nothing to decide.
 */

export type MergeVars = Record<string, string | number | null>;

/**
 * The names the PLATFORM owns. Everything else in a MergeVars is ours.
 *
 * The push sets these through the API's own first_name / last_name fields, so sending them
 * a second time inside custom_variables would create a custom variable with the same name
 * as the built-in. Which of the two {{firstName}} then resolves to is the platform's
 * business, not ours, and the day it changes its mind every email says "Hi ," again.
 *
 * The CSV has the opposite shape — a flat file with no separate fields — so there the two
 * columns stay and are mapped by TYPE on the import screen.
 */
export const PLATFORM_BUILT_INS = ['firstName', 'lastName'] as const;

/** Ours only: what the push may safely send as custom_variables. */
export function customOnly(vars: MergeVars): MergeVars {
  const out: MergeVars = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!(PLATFORM_BUILT_INS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/**
 * The agency website, from AppConfig. Absent means absent.
 *
 * Frank owns this value and has not supplied it. There is no default and there must not be
 * one: a guessed domain in a booking link is a link to somebody else's website, sent from
 * an address carrying Frank's name.
 */
export async function agencyWebsite(): Promise<string> {
  /**
   * From the merge-variable table (migration 047), which is now where somebody sets it on a
   * screen. AppConfig is still read as a fallback so an existing value keeps working, but
   * nothing writes there any more — two places to set one website is how the booking link
   * and the signature end up naming different domains.
   */
  const rows = await sql`
    SELECT "value" FROM "MergeVariable" WHERE "name" = 'agency_website'
    UNION ALL
    SELECT "value" FROM "AppConfig" WHERE "key" = 'agency_website'
    LIMIT 1` as Array<{ value: string }>;
  return String(rows[0]?.value ?? '').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The band a producer set by hand, or nothing.
 *
 * Returns an object to spread, so "no band" is the ABSENCE of both keys rather than two
 * nulls. A null merge variable is not a gap the platform will warn anyone about — it is a
 * populated cell containing a blank, and it renders mid-sentence as "somewhere between
 * and ". The keys have to not exist.
 *
 * Money is emitted as a plain integer string: the copy wraps it in its own currency symbol
 * ("$ {{ band_low }}"), so formatting here would read "$$925". Rounded because a renewal
 * estimate quoted to the penny claims a precision a band does not have.
 */
/**
 * Eligibility is part of the price, not a label beside it.
 *
 * Frank, 1 Oct 2026: "the lowest premium from a carrier that rated the home eligible".
 * A cheaper number from a carrier that declined the risk is not a price we can stand
 * behind — quoting it would mean opening with a figure no carrier will honour.
 *
 * Only the exact string "eligible" counts. The column also holds "review" and
 * "ineligible", and a truthiness test would have treated both as a yes: on 196069171
 * Travelers is "review" at $860 against an eligible Plymouth at $1,075, so a loose test
 * publishes a band $215 under anything obtainable.
 */
const RATED_ELIGIBLE = (v: unknown) => String(v ?? '').trim().toLowerCase() === 'eligible';

export function bandBaseline(
  lead: Record<string, any>,
): { premium: number; carrier: 'travelers' | 'plymouth' } | null {
  const options: Array<{ premium: number; carrier: 'travelers' | 'plymouth' }> = [];
  const t = Number(lead?.travelersPremium);
  if (Number.isFinite(t) && t > 0 && RATED_ELIGIBLE(lead?.travelersEligible)) {
    options.push({ premium: t, carrier: 'travelers' });
  }
  const p = Number(lead?.plymouthPremium);
  if (Number.isFinite(p) && p > 0 && RATED_ELIGIBLE(lead?.plymouthEligible)) {
    options.push({ premium: p, carrier: 'plymouth' });
  }
  if (!options.length) return null;
  options.sort((a, b) => a.premium - b.premium);
  return options[0];
}

/**
 * The band a homeowner actually reads.
 *
 * ── Why it is derived and not stored ────────────────────────────────────────
 * On 30 Sep exactly 4 leads in the whole database carried a band while 1,836 Grade A
 * leads did not, and every priced email was going out with a hole where the number
 * belonged. The carrier premiums were there the whole time. A stored band would have
 * meant a backfill today and another one every week as cards are rated, with the email
 * silently wrong in the gap between rating and backfill. Derived, a card is priced the
 * moment a carrier rates it.
 *
 * ── Rounding ────────────────────────────────────────────────────────────────
 * Frank, 1 Oct 2026: low is 90% of the baseline "rounded down to $25", high is 105%.
 * He specified rounding only on the low side. The high is rounded OUTWARD to the same
 * $25 step, because the two errors are not equal: a band that is $20 too wide costs
 * nothing, and a band the real quote lands just above makes the opening number look
 * like a bait. Flagged to him rather than left as a silent reading of his rule.
 */
const DOWN_TO_25 = (n: number) => Math.floor(n / 25) * 25;
const UP_TO_25 = (n: number) => Math.ceil(n / 25) * 25;

function bandVars(lead: Record<string, any>): Record<string, string> {
  /**
   * A band set by hand outranks the formula. It is how an underwriter overrides a
   * machine, and a derivation that quietly wins over a person's correction is a
   * derivation nobody can steer.
   */
  const setLow = Number(lead?.indicativeBandLow);
  const setHigh = Number(lead?.indicativeBandHigh);
  if (Number.isFinite(setLow) && Number.isFinite(setHigh) && setLow > 0 && setHigh > 0
      && setHigh >= setLow) {
    return { band_low: String(Math.round(setLow)), band_high: String(Math.round(setHigh)) };
  }

  const base = bandBaseline(lead);
  if (!base) return {};
  const low = DOWN_TO_25(base.premium * 0.90);
  const high = UP_TO_25(base.premium * 1.05);
  // A zero floor or an inverted range is not a price range, and it would read as one.
  if (low <= 0 || high < low) return {};
  return { band_low: String(low), band_high: String(high) };
}

export function mergeVarsFor(
  lead: Record<string, any>,
  role: 'insured' | 'coInsured',
  /** Set on the variables screen. Until it is supplied the booking link stays empty. */
  agencyWebsite = '',
  /**
   * Variables whose value is the same for every homeowner, from the variables screen.
   *
   * Merged UNDER the per-lead values below, never over them. If the two ever carry the same
   * name the per-lead one wins, because it is the one that is actually about this household
   * — and nameProblem() refuses the collision at the point of typing anyway, so this is a
   * second lock on a door that should already be shut.
   */
  globals: Record<string, string> = {},
  /**
   * The three asks as edited on the CTA screen, keyed by step. Omitted by a caller with no
   * database to read, which then gets the wording compiled into CTA_BY_STEP.
   */
  ctas: Record<number, string> = {},
  /**
   * The subject lines as edited on the Subjects screen, keyed
   * segment|step|variant|cohortCode. Omitted by a caller with no database to read.
   */
  subjects: Record<string, string> = {},
): MergeVars {
  /**
   * ── The renewal date must not go near new Date() ─────────────────────────
   *
   * effectiveDate is stored as TEXT, 'YYYY-MM-DD'. `new Date('2026-10-18')` parses a bare
   * date string as UTC midnight, and reading it back with local getters in a zone behind UTC
   * returns the 17th. Every one of the 678 accounts on the send list rendered a renewal date
   * one day early — in the sentence Frank's copy states as fact, on the single thing we claim
   * to know about someone's house.
   *
   * The month was worse: a renewal on the 1st would have named the PREVIOUS month, so
   * "your November renewal" would have gone out to people renewing in November as
   * "your October renewal".
   *
   * A stored 'YYYY-MM-DD' is already the answer. It is used as-is, and only a value in some
   * other shape is parsed — with an explicit local time, so midnight stays midnight here.
   */
  const raw = String(lead.effectiveDate ?? '').trim();
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) ? raw.slice(0, 10) : null;
  const eff = ymd
    ? new Date(`${ymd}T00:00:00`)
    : (lead.effectiveDate ? new Date(lead.effectiveDate) : null);
  const renewal = ymd
    ?? (eff && !Number.isNaN(eff.getTime())
      ? `${eff.getFullYear()}-${pad(eff.getMonth() + 1)}-${pad(eff.getDate())}`
      : '');
  const month = eff && !Number.isNaN(eff.getTime())
    ? eff.toLocaleString('en-US', { month: 'long' })
    : '';
  /** §5.1's {{ street_name }} — the road without the house number. */
  const streetName = String(lead.addressStreet ?? '').replace(/^\s*\d+\s*/, '').trim();
  const town = lead.addressCity ?? '';

  const segment = (lead.campaignSegment ?? 'unrated') as Segment;
  const cohortDate = String(lead.cohort ?? '');
  const variant: 'A' | 'B' = (role === 'insured' ? lead.insuredSubjectVariant : lead.coInsuredSubjectVariant) === 'B' ? 'B' : 'A';
  const armRaw = role === 'insured' ? lead.insuredCtaArm : lead.coInsuredCtaArm;
  const arm: 1 | 2 = Number(armRaw) === 2 ? 2 : 1;
  const steps = stepsFor(cohortDate);

  /**
   * Resolved here rather than left as {{ }} for the platform to fill.
   *
   * A subject line carrying its own nested variable is a second chance to fail, and a blank
   * subject is both an unopened email and a spam signal.
   */
  /**
   * The booking link, built once and used twice — as its own variable and inside the CTA.
   * Empty until Frank supplies the website.
   */
  const meetingLink = agencyWebsite ? `${agencyWebsite.replace(/\/+$/, '')}/meet` : '';

  const fill = (t: string) => t
    .replace(/\{\{\s*month\s*\}\}/g, month)
    .replace(/\{\{\s*street_name\s*\}\}/g, streetName)
    .replace(/\{\{\s*renewal_date\s*\}\}/g, renewal)
    .replace(/\{\{\s*town\s*\}\}/g, town)
    .replace(/\{\{\s*agency_website\s*\}\}/g, agencyWebsite.replace(/\/+$/, ''));

  /**
   * ── The subject comes from the Subjects screen, not from this file ───────
   *
   * Same move as the CTAs, and the same fallback: a caller with no database to read gets
   * the compiled wording. A subject is the one field an email cannot send without — a blank
   * one is both an unopened email and a spam signal — so an empty stored value falls through
   * to subjectFor() rather than being sent as nothing.
   */
  const subjectAt = (step: number) => {
    if (!steps.includes(step)) return '';
    /**
     * Keyed by cohort as well, because that is one of the axes the copy varies on: §1.2
     * has C1–C5 leading with the number and C6/C7 introducing first. A key without it would
     * serve one cohort's line to all seven — and it would look right, because every line in
     * the table is a real line somebody wrote.
     */
    const code = `C${cohortNumber(cohortDate)}`;
    const stored = subjects[`${segment}|${step}|${variant}|${code}`]
      // Grade B's pair carries no cohort: one question, every week.
      ?? subjects[`${segment}|${step}|${variant}|*`];
    return fill(stored || subjectFor({ segment, cohort: cohortDate, step, variant }).template);
  };

  /**
   * ── The CTA goes through `fill` too, and that is the whole point ──────────
   *
   * It did not. Subjects were filled and CTAs were handed over raw, so three of the seven
   * arms — every one that offers a booking link — travelled with "{{ agency_website }}/meet"
   * still in the text. 92 of the 186 C1–C3 contacts carried it.
   *
   * A value merged into a template is not re-scanned for variables, so the braces do not
   * resolve on the far side: they print. The email would have read "Grab 15 minutes here:
   * {{ agency_website }}/meet" to a homeowner, and nothing in the CRM, the export or the
   * platform would have said a word about it — the cell was populated, it just said the
   * wrong thing.
   *
   * When the website is unknown the arm returns EMPTY rather than "…here: /meet". A blank
   * CTA is a gap somebody has to close before the step can send; a link to nowhere is a
   * broken promise that sends perfectly. Same reasoning as band_low, and `missingLink`
   * below exists so the gap is counted out loud instead of discovered in an inbox.
   */
  /**
   * ── The wording comes from the CTA screen, not from this file ────────────
   *
   * Abdullah, 1 Oct 2026: the three asks are edited in the CRM under Campaigns, one value
   * each, so every lead picks up the same wording and Zoya can change a sentence without a
   * deploy. `ctas` carries those values; CTA_BY_STEP remains as the floor for a caller that
   * has no database to read — and for Grade B, whose single ask (§3, "R4 · Single arm, wave
   * two") is a different offer rather than a variant of these three.
   *
   * Note what this ends: with one wording per step there is no longer an arm 1 and an arm 2
   * to deal people between, so the CTA half of the §3 A/B test stops. The subject-line
   * variant is untouched, and `arm` is still carried on the lead and still reported, so a
   * past result stays readable.
   */
  const ctaAt = (step: number) => {
    if (!steps.includes(step)) return '';
    const wording = segment === 'grade_b'
      ? GRADE_B_CTA.wording
      : (ctas[step] ?? CTA_BY_STEP[step][arm].wording);
    if (!meetingLink && /\{\{\s*agency_website\s*\}\}/.test(wording)) return '';
    return fill(wording);
  };

  /**
   * ── Two naming schemes, because the platform has two kinds of variable ───
   *
   * BUILT-INS are the platform's own and their spelling is fixed: {{firstName}},
   * {{lastName}}. On import they are mapped by TYPE — the "First Name" entry in the column
   * dropdown — so the header only has to be recognisable to a person.
   *
   * CUSTOM VARIABLES are ours, and the name we give one is the name the template must use.
   * Zoya, 28 Sep 2026: map renewal_date, street_address, band_low, band_high and
   * meeting_link as Custom Variables. So those are snake_case, matching the copy Frank
   * wrote, and nothing has to be rewritten in the templates.
   *
   * Getting this wrong is silent. A template asking for a name that does not exist renders
   * nothing at all — a test send arrived reading "Hi ," while the contact was holding
   * "Abdullah" the whole time, because the copy said first_name and the built-in is
   * firstName.
   */
  return {
    // Same for every homeowner, spread first so nothing below can be displaced by one.
    ...globals,

    // ── The platform's own, spelled its way ──
    firstName: (role === 'insured' ? lead.owner1FirstName : lead.owner2FirstName) ?? '',
    lastName: (role === 'insured' ? lead.owner1LastName : lead.owner2LastName) ?? '',

    // ── Ours, named as Frank's copy already writes them ──
    street_address: lead.addressStreet ?? '',
    street_name: streetName,
    town,
    renewal_date: renewal,
    month,
    /**
     * Kept because the platform already carries a field of this name from an earlier push,
     * and a template referring to it must not silently go blank. streetAddress is the one §5
     * actually uses.
     */
    property_address: [lead.addressStreet, lead.addressCity].filter(Boolean).join(', '),

    /**
     * The booking link, as one ready-made URL (Zoya, 28 Sep).
     *
     * The copy writes it as {{ agency_website }}/meet — two fragments the platform has to
     * join. Handing over the finished URL removes a place it can come out as "/meet" with
     * nothing in front, which is what §4 calls the single biggest deliverability decision in
     * the signature.
     *
     * Empty until Frank supplies the website, and empty is the honest answer: a booking link
     * that 404s is worse than no link.
     */
    meeting_link: meetingLink,

    // ── The assignment, as finished sentences ──
    subject_1: subjectAt(1), subject_2: subjectAt(2), subject_3: subjectAt(3),
    cta_1: ctaAt(1), cta_2: ctaAt(2), cta_3: ctaAt(3),

    // ── What a report groups by ──
    segment: SEGMENT_LABEL[segment] ?? String(segment),
    cohort: cohortCode(cohortDate) ?? cohortDate,
    subject_variant: variant,
    cta_arm: arm,
    version_label: versionLabel({ segment, cohort: cohortDate, step: 1, subjectVariant: variant, ctaArm: arm }),

    /**
     * ── band_low / band_high ─────────────────────────────────────────────────
     *
     * These were absent entirely, and the reason was sound: the CRM's lowPremium and
     * highPremium are derived from a machine-generated expectedPremium and sit a median
     * 3.2x above what the producer actually rated — on 531 of 540 rated accounts the
     * producer's own number falls below the band. Frank: "they would receive a band price
     * that doesn't exist."
     *
     * That objection was about lowPremium/highPremium. It was never about THESE fields.
     * indicativeBandLow/High are producer-entered, set by hand on the lead card, and Frank
     * spent the afternoon of 29 Sep filling them for C1–C3 — describing the result on the
     * call as already working: "band low, band high, that I filled in, and then it pulls up
     * to there." It did not. The keys were not emitted, so every figure he typed would have
     * reached the platform as nothing at all.
     *
     * The push has treated this field as the published band all along — it stamps
     * publishedBandLow/High from indicativeBandLow/High at send and judges the eventual bind
     * against it. So the value a homeowner is recorded as having been shown was already this
     * one; it simply never travelled into the email that was supposed to show it.
     *
     * ── Both, or neither ─────────────────────────────────────────────────────
     * A lead carrying a low and no high still renders "somewhere between $736 and " — worse
     * than an obvious gap, because it sends perfectly. Two C1–C3 cards are in exactly that
     * state today. When either half is missing the keys stay out, so the hole shows at
     * setup rather than in somebody's inbox. Same rule as the CTA link above.
     */
    ...bandVars(lead),

    /**
     * The producer's own figure, under its own name — never a band and never a range.
     * Carried so the export can show it beside the empty band columns, where the gap
     * between what a producer rated and what the CRM would have published is visible.
     */
    producer_premium: bandBaseline(lead)?.premium ?? null,
    /** Which carrier the band was built from, for the card and the export. */
    band_carrier: bandBaseline(lead)?.carrier ?? null,
    crm_property_id: lead.propertyId ?? null,
    crm_lead_id: lead.id ?? null,
  };
}
