/**
 * Why a quote was lost (directive Sec. 10.6), and what each answer is for.
 *
 * Frank's list, verbatim: "premium · coverage or terms · stayed with incumbent · bundled
 * elsewhere · not eligible / appetite · no response after quote · other".
 *
 * The competitor's carrier and premium are asked on EVERY lost conversation, not only when
 * the reason is premium. A lead lost on coverage still tells us who else is writing that
 * municipality and at what price, and that is the input Sec. 10.6 is really after:
 * "a rating and appetite input, not just a sales note".
 *
 * No imports — the producer panel needs these labels.
 */

export type LossReason =
  | 'premium'
  | 'coverage_terms'
  | 'stayed_with_incumbent'
  | 'bundled_elsewhere'
  | 'not_eligible'
  | 'no_response'
  | 'other';

export type LossReasonSpec = {
  key: LossReason;
  label: string;
  /** Why this one is worth separating from the others. */
  meaning: string;
  /**
   * Whether a competing carrier is expected. "No response" and "not eligible" usually have
   * none — asking for one anyway produces guesses, and a guessed competitor premium is
   * worse than a blank because it lands in the averages.
   */
  expectCompetitor: boolean;
  /** Worth coming back to at the next renewal. */
  reEngage: boolean;
};

export const LOSS_REASONS: LossReasonSpec[] = [
  {
    key: 'premium',
    label: 'Premium — we were more expensive',
    meaning: 'Price alone. The competitor figure here is what sets the gap we have to close.',
    expectCompetitor: true, reEngage: true,
  },
  {
    key: 'coverage_terms',
    label: 'Coverage or terms',
    meaning: 'Beaten on what was covered, not on price. A rating input, not a discounting one.',
    expectCompetitor: true, reEngage: true,
  },
  {
    key: 'stayed_with_incumbent',
    label: 'Stayed with their current carrier',
    meaning: 'Inertia rather than a better offer. Often winnable next cycle.',
    expectCompetitor: true, reEngage: true,
  },
  {
    key: 'bundled_elsewhere',
    label: 'Bundled elsewhere (auto / umbrella)',
    meaning: 'Lost to a bundle we did not offer. BIA handles auto separately — worth knowing how often this costs us a home policy.',
    expectCompetitor: true, reEngage: true,
  },
  {
    key: 'not_eligible',
    label: 'Not eligible / outside appetite',
    meaning: 'No carrier would write it. An appetite finding, and it should have been caught before the quote.',
    expectCompetitor: false, reEngage: false,
  },
  {
    key: 'no_response',
    label: 'No response after the quote',
    meaning: 'They raised their hand and then went quiet. If this clusters, the band set an expectation the quote did not meet.',
    expectCompetitor: false, reEngage: true,
  },
  {
    key: 'other',
    label: 'Other',
    meaning: 'Say what happened in the notes — a reason nobody can read is not a reason.',
    expectCompetitor: false, reEngage: true,
  },
];

export const LOSS_REASON_LABEL: Record<LossReason, string> = Object.fromEntries(
  LOSS_REASONS.map((r) => [r.key, r.label]),
) as Record<LossReason, string>;

/** Sec. 10.6: "re_engage_at — Next effective date minus 60 days". */
export const RE_ENGAGE_DAYS_BEFORE_RENEWAL = 60;
