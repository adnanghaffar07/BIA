/**
 * Every merge variable a sequence may use — the one list, shared by the editor and the
 * validator (Frank's directive §3, §6.2 · Zoya's import mapping, 28 Sep 2026).
 *
 * ── Why this is not just a nice palette ─────────────────────────────────────
 * A variable the template asks for and the contact does not carry renders as NOTHING.
 * No error, no bounce, no row in any log — the email simply goes out with a hole in it.
 * One already did: it reached a live inbox reading "Hi ," while the platform was holding
 * the name the whole time, because the copy said first_name and the built-in is firstName.
 *
 * So the palette is not a convenience. It is the list of names that exist, and the editor
 * refuses a subject or body that references anything outside it. Somebody writing copy in
 * the sequence editor cannot invent a variable, because inventing one is silent and the
 * place it shows up is a homeowner's inbox.
 *
 * ── Why it lives in lib/ and not in the service ─────────────────────────────
 * mergeVars.service reads AppConfig, so importing it from a client component would pull
 * the database driver into the browser bundle. This file has no imports at all, which is
 * what lets the editor and the export agree without either of them reaching for a
 * connection. `scripts/test-merge-vars.mjs` asserts the two sets are identical, so this
 * cannot quietly drift the way the four-chip version did.
 */

export type MergeFieldGroup = 'person' | 'property' | 'renewal' | 'copy' | 'link' | 'tracking';

export type MergeField = {
  /** The variable name exactly as the platform holds it. */
  name: string;
  /** What goes in the subject or body. */
  token: string;
  label: string;
  /** A real value, from a real row on the current send list. */
  example: string;
  group: MergeFieldGroup;
  /**
   * Set when the variable is valid but renders EMPTY for everyone today, with the reason
   * and who owns it. Offered greyed rather than hidden: a missing chip reads as "we forgot
   * it" and gets typed by hand, which is the exact failure this file exists to stop.
   */
  blocked?: string;
};

export const MERGE_FIELD_GROUPS: { key: MergeFieldGroup; title: string; hint?: string }[] = [
  { key: 'copy', title: 'The email itself', hint: 'The subject line and the ask, already chosen and already balanced. Put these in the Subject and Body fields — the platform renders them, it does not pick them.' },
  { key: 'person', title: 'Who it goes to' },
  { key: 'property', title: 'Their house' },
  { key: 'renewal', title: 'Their renewal' },
  { key: 'link', title: 'Booking' },
  { key: 'tracking', title: 'Tracking', hint: 'Carried so a reply can be matched back to the right person and version. Not meant for the body of an email.' },
];

export const MERGE_FIELDS: MergeField[] = [
  /**
   * The resolved copy. §3: assignment is "Built in the CRM at list build and written to the
   * lead record — NOT in the email tool, whose randomiser will not balance across cohorts."
   *
   * So the Subject field of a campaign step is literally {{subject_1}}. Handing the platform
   * a variant LETTER would give it the decision back, and its randomiser would quietly
   * replace a balanced assignment with an unbalanced one — leaving the comparison the whole
   * wave exists to produce unreadable, while every report still called itself balanced.
   */
  { name: 'subject_1', token: '{{subject_1}}', label: 'Subject — email 1', example: "your October renewal — what I'd expect it to run", group: 'copy' },
  { name: 'subject_2', token: '{{subject_2}}', label: 'Subject — email 2', example: '2026-10-06 — the last stretch', group: 'copy' },
  { name: 'subject_3', token: '{{subject_3}}', label: 'Subject — email 3', example: '(C4–C7 only — blank for C1–C3)', group: 'copy' },
  { name: 'cta_1', token: '{{cta_1}}', label: 'Ask — email 1', example: 'Reply "yes" and I\'ll get started.', group: 'copy' },
  { name: 'cta_2', token: '{{cta_2}}', label: 'Ask — email 2', example: "Reply and I'll have your number back to you tomorrow.", group: 'copy' },
  { name: 'cta_3', token: '{{cta_3}}', label: 'Ask — email 3', example: '(C4–C7 only — blank for C1–C3)', group: 'copy' },

  { name: 'firstName', token: '{{firstName}}', label: 'First name', example: 'Trisha', group: 'person' },
  { name: 'lastName', token: '{{lastName}}', label: 'Last name', example: 'Mcnamara', group: 'person' },

  { name: 'street_address', token: '{{street_address}}', label: 'Street address', example: '83 Augustus Dr', group: 'property' },
  { name: 'street_name', token: '{{street_name}}', label: 'Street name only', example: 'Augustus Dr', group: 'property' },
  { name: 'town', token: '{{town}}', label: 'Town', example: 'Middletown', group: 'property' },
  { name: 'property_address', token: '{{property_address}}', label: 'Address with town', example: '83 Augustus Dr, Middletown', group: 'property' },

  { name: 'renewal_date', token: '{{renewal_date}}', label: 'Renewal date', example: '2026-10-06', group: 'renewal' },
  { name: 'month', token: '{{month}}', label: 'Renewal month', example: 'October', group: 'renewal' },

  /**
   * Frank owns the website and has not supplied it, so this is empty on all 186 C1–C3
   * contacts. It is the finished URL rather than a fragment, because the copy writes it as
   * {{ agency_website }}/meet and a value merged into a template is not re-scanned — the
   * braces would have printed, in the email, to the homeowner. 92 contacts were carrying
   * exactly that before it was caught.
   */
  { name: 'meeting_link', token: '{{meeting_link}}', label: 'Booking link', example: 'https://…/meet', group: 'link', blocked: 'Waiting on the agency website from Frank — empty on every contact until then.' },

  /**
   * band_low / band_high were blocked, and the reason has since been answered.
   *
   * The block was never about a missing feature: it was that no source could be trusted.
   * The CRM's own low/high pair is derived from a machine estimate sitting a median 3.2x
   * above what the producer actually rated — below the band on 531 of 540 rated accounts.
   * Frank: "they would receive a band price that doesn't exist."
   *
   * On 29 Sep 2026 he settled it by typing the range onto each card himself, judging it
   * against the producer's own rating. That is the source, and it is a person rather than a
   * model. These now carry whatever is on the card.
   *
   * Still empty on a card nobody has set, and still emitted only when BOTH halves are
   * present — see bandVars() in mergeVars.service.ts for why half a range is worse than
   * none. The example below is a real one of Frank's.
   */
  { name: 'band_low', token: '{{band_low}}', label: 'Band — low', example: '925', group: 'renewal' },
  { name: 'band_high', token: '{{band_high}}', label: 'Band — high', example: '1050', group: 'renewal' },

  { name: 'segment', token: '{{segment}}', label: 'Segment', example: 'Rated', group: 'tracking' },
  { name: 'cohort', token: '{{cohort}}', label: 'Cohort', example: 'C1', group: 'tracking' },
  { name: 'subject_variant', token: '{{subject_variant}}', label: 'Subject variant', example: 'A', group: 'tracking' },
  { name: 'cta_arm', token: '{{cta_arm}}', label: 'CTA arm', example: '1', group: 'tracking' },
  { name: 'version_label', token: '{{version_label}}', label: 'Version', example: 'Rated · C1 · Email 1 · Renewal month · Reply yes', group: 'tracking' },
  { name: 'producer_premium', token: '{{producer_premium}}', label: 'Producer premium', example: '1419', group: 'tracking' },
  { name: 'crm_property_id', token: '{{crm_property_id}}', label: 'CRM property id', example: '1000438593', group: 'tracking' },
  { name: 'crm_lead_id', token: '{{crm_lead_id}}', label: 'CRM lead id', example: '1000438593', group: 'tracking' },
];

export const MERGE_FIELD_NAMES: ReadonlySet<string> = new Set(MERGE_FIELDS.map((f) => f.name));

export const mergeFieldByName = (name: string): MergeField | undefined =>
  MERGE_FIELDS.find((f) => f.name === name);

/**
 * Every {{ … }} in a piece of copy, in the order written.
 *
 * Deliberately loose about whitespace, because Frank's copy is written both ways —
 * {{month}} and {{ agency_website }} both appear in the directive — and a validator that
 * only recognised one spelling would wave the other through as ordinary text.
 */
export function tokensIn(text: string): string[] {
  return [...String(text ?? '').matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]);
}

/**
 * The variables this copy asks for that do not exist.
 *
 * Returned rather than thrown so the editor can name every one of them at once. Somebody
 * fixing a typo one save at a time is somebody who stops reading the message.
 */
export function unknownTokensIn(text: string): string[] {
  const bad = tokensIn(text).filter((t) => !MERGE_FIELD_NAMES.has(t));
  return [...new Set(bad)];
}

/** The variables this copy asks for that exist but render empty today. */
export function blockedTokensIn(text: string): MergeField[] {
  const names = new Set(tokensIn(text));
  return MERGE_FIELDS.filter((f) => f.blocked && names.has(f.name));
}
