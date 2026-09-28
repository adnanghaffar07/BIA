import { sql } from '@/lib/neon';
import { subjectFor, stepsFor, versionLabel, CTA_BY_STEP, GRADE_B_CTA, COHORT_LABEL, SEGMENT_LABEL, type Segment } from './campaignSegment.service';

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
  const rows = await sql`
    SELECT "value" FROM "AppConfig" WHERE "key" = 'agency_website'` as Array<{ value: string }>;
  return String(rows[0]?.value ?? '').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function mergeVarsFor(
  lead: Record<string, any>,
  role: 'insured' | 'coInsured',
  /** From AppConfig. Frank owns it; until he supplies it the booking link stays empty. */
  agencyWebsite = '',
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

  const subjectAt = (step: number) => (steps.includes(step)
    ? fill(subjectFor({ segment, cohort: cohortDate, step, variant }).template)
    : '');

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
  const ctaAt = (step: number) => {
    if (!steps.includes(step)) return '';
    const wording = segment === 'grade_b' ? GRADE_B_CTA.wording : CTA_BY_STEP[step][arm].wording;
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
    cohort: COHORT_LABEL[cohortDate] ?? cohortDate,
    subject_variant: variant,
    cta_arm: arm,
    version_label: versionLabel({ segment, cohort: cohortDate, step: 1, subjectVariant: variant, ctaArm: arm }),

    /**
     * band_low and band_high are deliberately ABSENT.
     *
     * The CRM's lowPremium/highPremium are derived from a machine-generated expectedPremium
     * and sit a median 3.2x above what the producer actually rated — on 531 of 540 rated
     * accounts the producer's own number falls below the band. Frank: "they would receive a
     * band price that doesn't exist."
     *
     * Sending them as null would be no safer than sending them wrong: a null renders as a
     * blank in the middle of "I'd expect it somewhere between  and ." Leaving the keys out
     * entirely means the gap is visible at setup rather than at send.
     */

    /**
     * The producer's own figure, under its own name — never a band and never a range.
     * Carried so the export can show it beside the empty band columns, where the gap
     * between what a producer rated and what the CRM would have published is visible.
     */
    producer_premium: lead.travelersPremium ?? lead.plymouthPremium ?? null,
    crm_property_id: lead.propertyId ?? null,
    crm_lead_id: lead.id ?? null,
  };
}
