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

const pad = (n: number) => String(n).padStart(2, '0');

export function mergeVarsFor(
  lead: Record<string, any>,
  role: 'insured' | 'coInsured',
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
  const fill = (t: string) => t
    .replace(/\{\{\s*month\s*\}\}/g, month)
    .replace(/\{\{\s*street_name\s*\}\}/g, streetName)
    .replace(/\{\{\s*renewal_date\s*\}\}/g, renewal)
    .replace(/\{\{\s*town\s*\}\}/g, town);

  const subjectAt = (step: number) => (steps.includes(step)
    ? fill(subjectFor({ segment, cohort: cohortDate, step, variant }).template)
    : '');
  const ctaAt = (step: number) => (steps.includes(step)
    ? (segment === 'grade_b' ? GRADE_B_CTA.wording : CTA_BY_STEP[step][arm].wording)
    : '');

  /**
   * ── camelCase, because that is what the platform uses ────────────────────
   *
   * Instantly's own built-in variables are {{firstName}} and {{lastName}}, not
   * {{first_name}}. Frank's copy is written in snake_case, and the two do not meet: a test
   * send arrived reading "Hi ," while the platform was holding "Abdullah" the whole time.
   * Nothing errored — a name that does not exist simply renders as nothing, and an email
   * full of gaps looks exactly like an email with no data.
   *
   * Every key here is therefore the name the template must use, spelled the platform's way.
   * The API payload around this still takes first_name/last_name; that is their REQUEST
   * field naming and is a different thing from the merge variable it produces.
   */
  return {
    // ── What the copy merges ──
    firstName: (role === 'insured' ? lead.owner1FirstName : lead.owner2FirstName) ?? '',
    lastName: (role === 'insured' ? lead.owner1LastName : lead.owner2LastName) ?? '',
    streetAddress: lead.addressStreet ?? '',
    streetName,
    town,
    renewalDate: renewal,
    month,
    /**
     * Kept because the platform already carries a field of this name from an earlier push,
     * and a template referring to it must not silently go blank. streetAddress is the one §5
     * actually uses.
     */
    propertyAddress: [lead.addressStreet, lead.addressCity].filter(Boolean).join(', '),

    // ── The assignment, as finished sentences ──
    subject1: subjectAt(1), subject2: subjectAt(2), subject3: subjectAt(3),
    cta1: ctaAt(1), cta2: ctaAt(2), cta3: ctaAt(3),

    // ── What a report groups by ──
    segment: SEGMENT_LABEL[segment] ?? String(segment),
    cohort: COHORT_LABEL[cohortDate] ?? cohortDate,
    subjectVariant: variant,
    ctaArm: arm,
    versionLabel: versionLabel({ segment, cohort: cohortDate, step: 1, subjectVariant: variant, ctaArm: arm }),

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
    producerPremium: lead.travelersPremium ?? lead.plymouthPremium ?? null,
    crmPropertyId: lead.propertyId ?? null,
    crmLeadId: lead.id ?? null,
  };
}
