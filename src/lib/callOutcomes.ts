/**
 * Call outcomes and what each one triggers (directive Sec. 10.5).
 *
 * The outcome list is short on purpose. Ruben is logging this on a phone between calls,
 * and the directive gives him fifteen seconds — a long list with fine distinctions gets
 * mis-tapped, and a mis-tapped outcome is worse than a coarse one because the follow-up
 * rules act on it.
 *
 * No imports: the panel needs these labels, and a value import from the service would drag
 * its server-only graph into the browser bundle.
 */

export type CallOutcome =
  | 'no_answer'
  | 'voicemail'
  | 'bad_number'
  | 'wrong_person'
  | 'callback_scheduled'
  | 'quote_requested'
  | 'not_interested'
  | 'do_not_call';

export type CallOutcomeSpec = {
  key: CallOutcome;
  label: string;
  /** What Sec. 10.5 says follows. Shown on the control, so no consequence is a surprise. */
  follows: string;
  /** A person was actually spoken to. Decides `contacted` and stops the retry cadence. */
  reached: boolean;
  /** The number is dead or belongs to someone else — never dial it again. */
  invalidatesNumber: boolean;
  /** Suppress the whole household, at the reason suppression.service derives. */
  suppresses?: 'not_interested' | 'dnc';
  /** Needs a date, so the reminder has something to fire at. */
  needsCallbackAt?: boolean;
  tone: 'good' | 'neutral' | 'bad';
};

export const CALL_OUTCOMES: CallOutcomeSpec[] = [
  {
    key: 'no_answer',
    label: 'No answer',
    follows: 'Retry per cadence.',
    reached: false, invalidatesNumber: false, tone: 'neutral',
  },
  {
    key: 'voicemail',
    label: 'Voicemail left',
    follows: 'Retry per cadence.',
    reached: false, invalidatesNumber: false, tone: 'neutral',
  },
  {
    key: 'bad_number',
    label: 'Bad number / disconnected',
    follows: 'That number is marked invalid. The next number on the card is used.',
    reached: false, invalidatesNumber: true, tone: 'bad',
  },
  {
    key: 'wrong_person',
    label: 'Wrong person',
    follows: 'That number is marked invalid and never retried.',
    reached: false, invalidatesNumber: true, tone: 'bad',
  },
  {
    key: 'callback_scheduled',
    label: 'Reached — callback scheduled',
    follows: 'A reminder is set for the date and time you give.',
    reached: true, invalidatesNumber: false, needsCallbackAt: true, tone: 'good',
  },
  {
    key: 'quote_requested',
    label: 'Reached — quote requested',
    follows: 'Handed to the quoting workflow.',
    reached: true, invalidatesNumber: false, tone: 'good',
  },
  {
    key: 'not_interested',
    label: 'Reached — not interested',
    follows: 'Household suppressed, reason recorded.',
    reached: true, invalidatesNumber: false, suppresses: 'not_interested', tone: 'bad',
  },
  {
    key: 'do_not_call',
    label: 'Reached — do not call',
    follows: 'DNC flag, household suppressed on every channel.',
    reached: true, invalidatesNumber: false, suppresses: 'dnc', tone: 'bad',
  },
];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = Object.fromEntries(
  CALL_OUTCOMES.map((o) => [o.key, o.label]),
) as Record<CallOutcome, string>;

/** Derived from the attempts, never typed. */
export type CallStatus = 'not_attempted' | 'attempting' | 'contacted' | 'unreachable';

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  not_attempted: 'Not attempted',
  attempting: 'Attempting',
  contacted: 'Contacted',
  unreachable: 'Unreachable',
};

/**
 * The stop rule, verbatim from Sec. 10.5:
 *
 *   "four attempts, three or more different days, two or more numbers where they exist
 *    → unreachable, leaves the active queue, joins the direct-mail segment. Never
 *    deleted, never downgraded."
 *
 * All three conditions, not any of them. Four calls in one afternoon to one number is not
 * a lead that cannot be reached — it is a lead called badly, and retiring it would hide
 * the difference. The "where they exist" clause is why the number condition is waived for
 * a card that only ever had one.
 */
export const UNREACHABLE_RULE = {
  minAttempts: 4,
  minDistinctDays: 3,
  minDistinctNumbers: 2,
} as const;
