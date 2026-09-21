/**
 * The eight reply classifications, and what each one triggers (directive Sec. 7.6).
 *
 * Frank's wording: "Without it the engagement number in your end-of-day report cannot be
 * computed." That is the narrow reason. The wider one is that a classification is an
 * INSTRUCTION, not a label — "stop" has to suppress the household, "wrong timing" has to
 * schedule the return, and if the list and the actions live apart they drift and a card
 * ends up saying the customer asked us to stop while the next cohort mails them anyway.
 *
 * So the action travels with the class, in one table, read by both the screen and the
 * service. No imports here: the UI needs these labels, and a value import from the service
 * would drag its server-only graph into the browser bundle.
 */

export type ReplyClass =
  | 'interested'
  | 'wrong_timing'
  | 'question'
  | 'not_interested'
  | 'stop'
  | 'wrong_person'
  | 'auto_reply'
  | 'hostile';

export type ReplyClassSpec = {
  key: ReplyClass;
  label: string;
  /** What Sec. 7.6 says happens. Shown on the button so the consequence is never a surprise. */
  triggers: string;
  /** Written as a durable suppression, at the scope suppression.service derives. */
  suppresses?: 'not_interested' | 'unsubscribe' | 'complaint' | 'dnc';
  /** Put the lead back 60 days before its next effective date. */
  reEngage?: boolean;
  /** Ruben, now. */
  hot?: boolean;
  /** Counts toward engagement — a reply, measured on delivered. */
  engagement?: boolean;
  tone: 'good' | 'neutral' | 'bad';
};

export const REPLY_CLASSES: ReplyClassSpec[] = [
  {
    key: 'interested',
    label: 'Interested — wants a quote or review',
    triggers: 'Ruben, hot. Address confirmed, every other send to the household stops.',
    hot: true, engagement: true, tone: 'good',
  },
  {
    key: 'wrong_timing',
    label: 'Interested — wrong timing ("call me at renewal")',
    triggers: 'Sequence stops. Returns 60 days before the next effective date.',
    reEngage: true, engagement: true, tone: 'good',
  },
  {
    key: 'question',
    label: 'Question / needs information',
    triggers: 'Ruben responds. Sequence pauses.',
    engagement: true, tone: 'neutral',
  },
  {
    key: 'not_interested',
    label: 'Not interested',
    triggers: 'Household suppressed, reason recorded.',
    suppresses: 'not_interested', engagement: true, tone: 'bad',
  },
  {
    key: 'stop',
    label: 'Stop / unsubscribe / complaint',
    triggers: 'Household suppressed immediately. No further contact on any channel.',
    suppresses: 'unsubscribe', tone: 'bad',
  },
  {
    key: 'wrong_person',
    label: 'Wrong person / not the owner',
    triggers: 'That address marked invalid. Household re-checked before any further send.',
    tone: 'neutral',
  },
  {
    key: 'auto_reply',
    label: 'Auto-reply or out of office',
    triggers: 'Logged and ignored. Not engagement, and it never confirms an address.',
    tone: 'neutral',
  },
  {
    key: 'hostile',
    label: 'Hostile',
    triggers: 'Suppressed immediately and flagged to Adnan and Frank.',
    suppresses: 'dnc', tone: 'bad',
  },
];

export const REPLY_CLASS_LABEL: Record<ReplyClass, string> = Object.fromEntries(
  REPLY_CLASSES.map((c) => [c.key, c.label]),
) as Record<ReplyClass, string>;
