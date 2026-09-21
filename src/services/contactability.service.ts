import { insuredEmails, insuredPhones, coInsuredEmails, coInsuredPhones } from './recipients.service';
import { type Contactability, type Channel, CHANNEL_OF } from '@/lib/contactability';

/**
 * contactability — how we can reach a lead (directive Sec. 4.1, tasks 27/28).
 *
 * ── Why this is not a grade ─────────────────────────────────────────────────
 * Grade A describes appetite and fit. It says nothing about whether we hold an email
 * address, and until now there was no field that did — so "Grade A" was used as an email
 * list and silently included people we cannot email. That is the whole of the 15 Sep
 * friction: C1 showed 74 Grade A and only 45 were usable. Nothing was broken; the segment
 * could not be seen.
 *
 * So: contactability is its own dimension. Campaign lists are built from it, never from
 * grade alone. Contact data may move a lead to D only when BOTH channels are missing, and
 * never between A, B and C.
 *
 * ── Why it is derived and not stored ────────────────────────────────────────
 * A stored column is wrong the instant a trace lands, and this value changes every time
 * one does. Every count in the CRM that has ever disagreed with another has done so
 * because two places computed the same thing from different columns. This is computed
 * once, here, and read everywhere — the ledger, the QC reports, the campaign export and
 * the direct-mail segment all call this function, so they cannot disagree.
 *
 * If the email tool later needs the value physically on an exported row, it is written
 * FROM this function rather than maintained alongside it.
 *
 * ── Insured, or anyone on the card? ─────────────────────────────────────────
 * Both, because they answer different questions and the difference is material — 310
 * leads across C1–C7 are Grade A with nothing for the insured.
 *
 *   contactabilityOf()  — the NAMED INSURED only. This is the campaign's truth: E1 sends
 *                         to the insured (Sec. 7.1), so this decides the channel.
 *   householdReach()    — any address or number anywhere on the card. This is the
 *                         GRADING rule's truth ("D only when neither"), and it is what
 *                         decides whether a lead is genuinely unreachable or whether the
 *                         household can still be called.
 *
 * Quoting one as the other is how a cohort promises reach the tool will not act on.
 */

/**
 * The vocabulary lives in @/lib/contactability — no imports, so the client can read the
 * labels without dragging this file's server-only import graph into the browser bundle.
 * Re-exported here so callers that already have the service need only one import.
 */
export type { Contactability, Channel } from '@/lib/contactability';
export { CONTACTABILITY_LABEL, CHANNEL_LABEL, CHANNEL_OF } from '@/lib/contactability';

type LeadLike = Record<string, unknown>;

function classify(hasEmail: boolean, hasPhone: boolean): Contactability {
  if (hasEmail && hasPhone) return 'email_and_phone';
  if (hasEmail) return 'email_only';
  if (hasPhone) return 'phone_only';
  return 'none';
}

/**
 * The campaign's value: what we hold for the NAMED INSURED.
 *
 * Requires the recipient columns — see RECIPIENT_COLS in recipients.service. A row
 * selected without them reads as `none` for every lead, which would route a whole cohort
 * to direct mail.
 */
export function contactabilityOf(lead: LeadLike): Contactability {
  return classify(insuredEmails(lead).length > 0, insuredPhones(lead).length > 0);
}

/** Anything anywhere on the card, insured or co-insured — the grading rule's test. */
export function householdReach(lead: LeadLike): Contactability {
  return classify(
    insuredEmails(lead).length > 0 || coInsuredEmails(lead).length > 0,
    insuredPhones(lead).length > 0 || coInsuredPhones(lead).length > 0,
  );
}

/** Which channel works this lead. */
export function channelOf(lead: LeadLike): Channel {
  return CHANNEL_OF[contactabilityOf(lead)];
}

/**
 * The direct-mail segment (Sec. 4.2): nothing for the insured AND nothing for the
 * household either. Flagged, never regraded — a lead with no email is not a worse
 * prospect, it is a prospect on a different channel.
 *
 * A lead with nothing for the insured but a co-insured number is NOT here: the household
 * can still be called, so it belongs to Ruben's queue rather than to the post.
 */
export function isDirectMailOnly(lead: LeadLike): boolean {
  return householdReach(lead) === 'none';
}

/**
 * A lead the campaign cannot email but the CARD can still reach — the gap between the two
 * measures above. These are the leads that make "Grade A" look like a working email list
 * when it is not.
 */
export function insuredUnreachableButHouseholdIs(lead: LeadLike): boolean {
  return contactabilityOf(lead) === 'none' && householdReach(lead) !== 'none';
}

export type ContactabilityBreakdown = Record<Contactability, number> & {
  /** email_and_phone + email_only — the E1 send list. */
  emailable: number;
  total: number;
};

/** Tally a set of leads. Used by the ledger, the QC reports and the cohort table alike. */
export function breakdown(leads: LeadLike[]): ContactabilityBreakdown {
  const out = {
    email_and_phone: 0, email_only: 0, phone_only: 0, none: 0,
    emailable: 0, total: leads.length,
  } as ContactabilityBreakdown;
  for (const l of leads) out[contactabilityOf(l)]++;
  out.emailable = out.email_and_phone + out.email_only;
  return out;
}
