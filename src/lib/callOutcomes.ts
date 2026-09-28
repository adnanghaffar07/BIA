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
  /**
   * Stop the email sequence for this household.
   *
   * Frank: "Quote requested → quoting, and the email sequence pauses." Somebody who has
   * asked for a quote on the phone should not keep receiving the cold sequence that asked
   * them to — it reads as nobody at the agency talking to anybody else.
   *
   * The platform has no pause for one lead (see householdStop.service), so the recipient is
   * removed from the campaign. The CRM keeps the history either way.
   */
  pausesEmail?: boolean;
  /**
   * The suppression ends, rather than standing forever.
   *
   * "Not interested" is about THIS renewal. Without this flag it landed in exactly the same
   * permanent state as a do-not-call, quietly retiring a customer who said no to one year's
   * quote.
   */
  recontactBeforeNextRenewal?: boolean;
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
    follows: 'Handed to quoting. The email sequence stops — they are talking to us now.',
    reached: true, invalidatesNumber: false, pausesEmail: true, tone: 'good',
  },
  {
    key: 'not_interested',
    label: 'Reached — not interested',
    follows: 'Household left alone this cycle, and approached again 60 days before the next renewal.',
    reached: true, invalidatesNumber: false, suppresses: 'not_interested',
    recontactBeforeNextRenewal: true, tone: 'bad',
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

/**
 * Derived from the attempts, never typed.
 *
 * ── Why "contacted" was split ───────────────────────────────────────────────
 * Frank, 25 Sep 2026: "'Contacted' is too broad. The status should follow the outcome."
 *
 * One word covered four situations that need four different things to happen next: a
 * callback in the diary, a quote being worked, a customer who said no this year, and a
 * customer who said never. Reading the queue told you somebody had been spoken to and
 * nothing about what was owed to them — so the follow-up lived in whoever remembered the
 * call, which is the infrastructure gap Frank names in the same message.
 */
export type CallStatus =
  | 'not_attempted'
  | 'attempting'
  | 'callback_due'
  | 'quoting'
  | 'not_interested'
  | 'do_not_call'
  | 'unreachable';

export const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  not_attempted: 'Not attempted',
  attempting: 'Attempting',
  callback_due: 'Callback due',
  quoting: 'Quoting',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  unreachable: 'Unreachable',
};

/**
 * The status each reaching outcome produces.
 *
 * Kept beside the outcomes rather than derived by a chain of ifs in the service: the
 * mapping IS the rule Frank wrote down, and a rule expressed as control flow is a rule
 * nobody can check against the message that asked for it.
 */
/**
 * The statuses that mean a person was actually spoken to.
 *
 * Splitting "contacted" into four left every place that counted contacts asking a question
 * the type no longer answered. Funnels still need "how many did we reach" — that is a real
 * number and it is the sum of the four, not one of them.
 */
export const REACHED_STATUSES: readonly CallStatus[] = [
  'callback_due', 'quoting', 'not_interested', 'do_not_call',
];

export const isReachedStatus = (s: CallStatus | null | undefined): boolean =>
  !!s && (REACHED_STATUSES as readonly string[]).includes(s);

export const STATUS_FOR_OUTCOME: Partial<Record<CallOutcome, CallStatus>> = {
  callback_scheduled: 'callback_due',
  quote_requested: 'quoting',
  not_interested: 'not_interested',
  do_not_call: 'do_not_call',
};

/**
 * How long a "not interested" stands.
 *
 * Frank: "Not interested → re-contact 60 days before next renewal." Sixty days before the
 * renewal after the one we were calling about — so the household is left alone for this
 * cycle and approached again in good time for the next.
 */
export const NOT_INTERESTED_RECONTACT_DAYS_BEFORE_RENEWAL = 60;

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
