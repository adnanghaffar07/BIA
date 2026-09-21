/**
 * contactability — the vocabulary, with no imports.
 *
 * ── Why this is in lib/ and not in the service ──────────────────────────────
 * The QC page needs the LABELS, and a label is a value, not a type. Importing a value
 * from contactability.service drags its whole import graph into the browser bundle:
 *
 *   contactability.service → recipients.service → skipTrace.service → @/lib/constants
 *
 * and @/lib/constants reads process.env.NEXT_PUBLIC_REAL_ESTATE_API_KEY, which Next
 * INLINES at build time. So a one-line import of a label map would have shipped the Real
 * Estate API key to every visitor — the same class of leak as directive S1, created while
 * fixing a different item. The QC page has been killed once already by this exact chain
 * (importing LOST_TARGET_PCT pulled in @/lib/neon), which is why src/lib/targets.ts exists.
 *
 * Everything here is a plain constant with no dependencies, so it is safe on both sides.
 * The behaviour — deciding which value a lead has — stays in contactability.service, which
 * is server-only because it needs the recipient rules.
 */

export type Contactability = 'email_and_phone' | 'email_only' | 'phone_only' | 'none';

/** Where a lead is worked, given how it can be reached (directive Sec. 4.2). */
export type Channel = 'email' | 'phone' | 'mail';

export const CONTACTABILITY_LABEL: Record<Contactability, string> = {
  email_and_phone: 'Email + phone',
  email_only: 'Email only',
  phone_only: 'Phone only',
  none: 'Neither',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email campaign',
  phone: 'Call queue',
  mail: 'Direct mail',
};

export const CHANNEL_OF: Record<Contactability, Channel> = {
  email_and_phone: 'email',
  email_only: 'email',
  phone_only: 'phone',
  none: 'mail',
};
