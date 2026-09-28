import { listEmailAccounts, getEmailAccount, updateEmailAccount } from '@/lib/integrations/leadCampaign';

/**
 * The sending mailbox's own signature (Frank's directive §4, §5).
 *
 * ── Why it lives on the mailbox and not on the contact ──────────────────────
 * A merge variable belongs to the CONTACT. The platform picks which of 28 mailboxes sends
 * at send time, so a signature carried on the contact would be a guess about who is sending
 * — and wrong most of the time. The result would be an email FROM danielr@ SIGNED "Anthony
 * Marino", with Anthony's licence number underneath. A spam filter reads that as spoofing
 * and a homeowner reads it as a scam.
 *
 * The platform does hold a signature per mailbox. It is simply not surfaced in the screen
 * anybody was looking at, which is why this looked impossible. It is read and written here
 * so the CRM can check it before a send rather than after one.
 *
 * ── Why the CRM cares at all ────────────────────────────────────────────────
 * §5: "Compliance is not optional. Postal address in the signature, opt-out line in the
 * signature." Both of those live ONLY in the signature. A mailbox with an empty one sends a
 * non-compliant email, and nothing anywhere would say so — 27 of 28 mailboxes were empty
 * when this was written.
 */

export type MailboxSignature = {
  email: string;
  name: string;
  /** The raw HTML the platform stores, exactly as it stores it. */
  html: string | null;
  /** The same thing as a person would read it — for checking, never for writing back. */
  text: string;
  present: boolean;
  /** §5's two compliance items, which live nowhere else. */
  hasPostalAddress: boolean;
  hasOptOut: boolean;
  problems: string[];
};

/**
 * Plain text → the HTML the platform stores.
 *
 * The platform stores and sends HTML, so a signature written as plain text would arrive as
 * one run-on line: the postal address folded into the opt-out line folded into the phone
 * number. Newlines therefore become <br>, and the four characters that mean something in
 * HTML are escaped so a producer whose agency name contains an ampersand does not silently
 * produce broken markup.
 *
 * Deliberately the exact inverse of signatureText() below. The pair has to round-trip
 * unchanged or editing a signature would slowly rewrite it — every save losing a blank line
 * or gaining one, until the block nobody re-read no longer says what §5 requires.
 */
export function textToSignatureHtml(text: string): string {
  const body = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
    .split('\n')
    .join('<br>');
  return body ? `<div>${body}</div>` : '';
}

/**
 * Can this signature be edited as plain text without losing anything?
 *
 * False when the stored HTML carries more than line breaks — a link, an image, bold, a
 * table. Converting that to text and back would quietly discard it, and the most likely
 * thing to be discarded is an anchor around the booking URL, which §4 calls the single
 * biggest deliverability decision in the signature.
 */
export function isPlainTextSafe(html: string | null | undefined): boolean {
  const tags = String(html ?? '').match(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi) ?? [];
  return tags.every((t) => /^<\/?(div|br|p)\b[^>]*>$/i.test(t));
}

/** HTML the platform stores → what a reader sees. Used for checking, not for round-tripping. */
export function signatureText(html: string | null | undefined): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    /**
     * &amp; LAST, and that ordering is the whole point.
     *
     * Decode it first and "&amp;lt;" becomes "&lt;" becomes "<" — an escaped ampersand
     * followed by the letters lt turns into a tag bracket that was never in the text. Going
     * last, every other entity is already a literal character and cannot be re-read.
     *
     * &lt; and &gt; were missing entirely, so a signature containing an angle bracket went
     * out as "&lt;" to the reader. Found by testing the round trip rather than the happy
     * path: "Smith & Sons <NJ>" came back as "Smith & Sons &lt;NJ&gt;".
     */
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * What is wrong with one signature, in the order it matters.
 *
 * Only things that are checkable are checked. Whether a licence number is real, or belongs
 * to the person whose name is above it, is not something code can answer — and pretending
 * a regex settles it would be worse than saying nothing.
 */
function problemsWith(text: string, name: string): { problems: string[]; postal: boolean; optOut: boolean } {
  const problems: string[] = [];
  const lower = text.toLowerCase();

  if (!text) {
    return { problems: ['empty — this mailbox would send with no signature at all'], postal: false, optOut: false };
  }

  /**
   * A postal address, required by §5 and by bulk-sender rules generally. Detected by a
   * street-shaped line rather than by a keyword, because "address" never appears in one.
   */
  const postal = /\d+\s+[A-Za-z][A-Za-z.\-' ]{2,}\s*(st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|ct|court|way|pl|place|hwy|suite|ste|#)\b/i.test(text)
    || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(text);
  if (!postal) problems.push('no postal address — §5 requires one in the signature');

  /** The opt-out line. §5: it does not substitute for the header, and the header does not substitute for it. */
  const optOut = /reply\s+"?stop"?/i.test(text) || /off my list/i.test(lower) || /unsubscrib/i.test(lower);
  if (!optOut) problems.push('no opt-out line — §5 requires one in the signature');

  if (!/licensed insurance producer/i.test(text)) {
    problems.push('does not say "Licensed Insurance Producer"');
  }
  /** A licence number that is still the placeholder, or absent behind the label. */
  if (/licen[cs]e\s*#\s*$/im.test(text) || /licen[cs]e\s*#\s*\n\s*$/im.test(text)) {
    problems.push('licence number label with nothing after it');
  }
  if (/\b123456789\b|\b000000000\b/.test(text)) {
    problems.push('licence number looks like a placeholder');
  }
  /** An unresolved merge variable in a signature renders as literal braces to the reader. */
  const leftovers = text.match(/\{\{[^}]*\}\}/g);
  if (leftovers) problems.push(`unresolved ${leftovers.join(', ')} — would print literally`);

  const first = String(name ?? '').trim().split(/\s+/)[0];
  if (first && !new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
    problems.push(`does not name ${name} — the mailbox sends as them`);
  }

  return { problems, postal, optOut };
}

/** One mailbox. */
export async function getSignature(email: string): Promise<MailboxSignature> {
  const a = await getEmailAccount(email) as Record<string, any>;
  const html = (a.signature ?? null) as string | null;
  const text = signatureText(html);
  const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
  const { problems, postal, optOut } = problemsWith(text, name);
  return {
    email, name, html, text,
    present: text.length > 0,
    hasPostalAddress: postal,
    hasOptOut: optOut,
    problems,
  };
}

/** Every sending mailbox, with what is wrong on each. */
export async function allSignatures(): Promise<MailboxSignature[]> {
  const accounts = await listEmailAccounts();
  const out: MailboxSignature[] = [];
  for (const a of accounts) out.push(await getSignature(String(a.email)));
  return out;
}

/**
 * Write a signature to one mailbox.
 *
 * The HTML is sent exactly as given. It is NOT rebuilt from the plain text: a signature that
 * survives a round trip through a text conversion is a signature whose formatting the round
 * trip decided, and the postal address and opt-out line are the parts most likely to be lost.
 */
export async function setSignature(email: string, html: string): Promise<MailboxSignature> {
  await updateEmailAccount(email, { signature: html });
  return getSignature(email);
}
