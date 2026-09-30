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
/**
 * Images that will not load in somebody's inbox.
 *
 * ── Why this is checked against the HTML and not the text ───────────────────
 * Every other check here reads the plain text, and signatureText() strips tags — so an image
 * is invisible to all of them. Frank's mailbox was carrying
 * `blob:https://app.instantly.ai/3c352f01-…`, a handle to something in the browser's own
 * memory that stops existing when the tab closes. It had been saved, it looked right in the
 * editor, and it would have rendered as a broken-image icon in every recipient's inbox.
 * Nothing anywhere said a word.
 *
 * A mail client fetches images over the public internet, as a stranger, with no session. So
 * the only source that works is an absolute https URL:
 *
 *   blob:      exists only in the tab that made it
 *   data:      Gmail and Outlook strip them
 *   http:      blocked as insecure by most clients
 *   relative   nothing to resolve it against
 */
function imageProblems(html: string | null | undefined): string[] {
  const out: string[] = [];
  const srcs = [...String(html ?? '').matchAll(/<img[^>]*\ssrc\s*=\s*["']([^"']*)["']/gi)]
    .map((m) => m[1].trim());

  for (const src of srcs) {
    if (/^https:\/\//i.test(src)) continue;
    if (/^blob:/i.test(src)) {
      out.push('the logo is a temporary browser link (blob:) — it will show as a broken image '
        + 'to everyone. Host the image and use its https address.');
    } else if (/^data:/i.test(src)) {
      out.push('the logo is embedded as data — Gmail and Outlook strip these. Host the image '
        + 'and use its https address.');
    } else if (/^http:\/\//i.test(src)) {
      out.push('the logo is on http, which most mail clients block. Use the https address.');
    } else {
      out.push(`the logo address "${src.slice(0, 40)}" is not a full web address, so no mail `
        + 'client can fetch it.');
    }
  }
  return out;
}

function problemsWith(
  text: string,
  name: string,
  html?: string | null,
): { problems: string[]; postal: boolean; optOut: boolean } {
  const problems: string[] = [];
  const lower = text.toLowerCase();

  /**
   * Checked before the empty test, because a signature that is ONLY a logo has no text at
   * all — and "empty" would be the one thing reported about a signature whose actual fault
   * is a broken image.
   */
  const imgs = imageProblems(html);

  if (!text) {
    return {
      problems: ['empty — this mailbox would send with no signature at all', ...imgs],
      postal: false,
      optOut: false,
    };
  }
  problems.push(...imgs);

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
  const { problems, postal, optOut } = problemsWith(text, name, html);
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
  /**
   * An image that cannot load is refused, not warned about.
   *
   * Every other fault here is reported and saved anyway, because they are judgement calls a
   * person may have a reason for — a signature can legitimately be a work in progress. A
   * broken image is not a judgement call. A blob: URL points into the memory of the browser
   * tab that made it and stops existing when that tab closes, so there is no state of the
   * world in which saving it is what somebody meant.
   *
   * It also cannot be seen: the editor shows the picture perfectly while the tab is open,
   * which is exactly how one reached a live mailbox and sat there.
   */
  const broken = imageProblems(html);
  if (broken.length) {
    throw new Error(
      `${broken[0]} Nothing was saved — fix the image address and save again.`,
    );
  }
  await updateEmailAccount(email, { signature: html });
  return getSignature(email);
}

/**
 * ── Applying one signature template across every mailbox ────────────────────
 *
 * Frank owns the wording; this owns getting it onto 28 mailboxes correctly. It is written
 * now, before he has supplied it, so the gap between "here is the block" and "every mailbox
 * is compliant" is one command rather than an afternoon of pasting.
 *
 * ── Why it is a template and not one block ──────────────────────────────────
 * A mailbox sends as its own producer. §5 requires the signature to name them, and the
 * compliance check enforces it — so pasting one identical block across 28 mailboxes would
 * produce 27 signatures naming the wrong person, which reads to a spam filter as spoofing
 * and to a homeowner as a scam.
 *
 * The producer's name comes from the account itself. Licence number and direct phone are
 * per-person and nothing in this system knows them, so they are supplied and the render
 * REFUSES on any that are missing rather than writing a signature with a blank where a
 * licence number belongs.
 */

export type SignatureValues = {
  /** Same for every mailbox. */
  agencyWebsite?: string | null;
  officeAddress?: string | null;
  /** Per mailbox, keyed by address, lower-cased. */
  perMailbox: Map<string, { licenseNumber?: string | null; directPhone?: string | null }>;
};

export type SignaturePlan = {
  email: string;
  name: string;
  text: string;
  html: string;
  /** What would still be wrong AFTER writing this. Empty means compliant. */
  problems: string[];
  /** Placeholders the template asked for and nothing supplied. */
  missing: string[];
};

/**
 * Render the template for one mailbox.
 *
 * Unresolved placeholders are collected rather than left in the text. A signature reading
 * "NJ Producer License #{{ license_number }}" is worse than one with no licence line: it
 * proves nobody checked, and it goes out under a producer's name.
 */
export function renderSignature(
  template: string,
  mailbox: { email: string; name: string },
  values: SignatureValues,
): { text: string; missing: string[] } {
  const per = values.perMailbox.get(mailbox.email.trim().toLowerCase()) ?? {};
  const table: Record<string, string | null | undefined> = {
    producer_name: mailbox.name,
    license_number: per.licenseNumber,
    producer_direct_phone: per.directPhone,
    agency_website: values.agencyWebsite,
    office_address: values.officeAddress,
  };

  const missing: string[] = [];
  const text = String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = table[key];
    if (v == null || String(v).trim() === '') {
      if (!missing.includes(key)) missing.push(key);
      return whole;
    }
    return String(v).trim();
  });

  return { text, missing };
}

/**
 * What writing this template would produce on every mailbox. Touches nothing.
 *
 * Every signature is checked with the SAME rules the audit uses, so a plan reporting no
 * problems and a later audit reporting some cannot disagree.
 */
export async function planSignatures(
  template: string,
  values: SignatureValues,
): Promise<SignaturePlan[]> {
  const accounts = await listEmailAccounts();
  return accounts.map((a) => {
    const email = String(a.email);
    const name = [(a as Record<string, any>).first_name, (a as Record<string, any>).last_name]
      .filter(Boolean).join(' ').trim();
    const { text, missing } = renderSignature(template, { email, name }, values);
    const html = textToSignatureHtml(text);
    // html here is generated from plain text, so it can carry no image — passed anyway so
    // the two call sites cannot drift about what is checked.
    const { problems } = problemsWith(text, name, html);
    return { email, name, text, html, problems, missing };
  });
}

/**
 * Write the plan.
 *
 * Refuses any mailbox whose render left a placeholder unresolved or whose result would still
 * fail the compliance check — writing those would replace an empty signature, which is
 * visibly broken, with a plausible one that is quietly non-compliant. The refused ones are
 * returned by name so somebody can supply what is missing.
 */
export async function applySignatures(
  template: string,
  values: SignatureValues,
): Promise<{ written: string[]; refused: Array<{ email: string; why: string[] }> }> {
  const plans = await planSignatures(template, values);
  const written: string[] = [];
  const refused: Array<{ email: string; why: string[] }> = [];

  for (const p of plans) {
    const why = [
      ...p.missing.map((m) => `nothing supplied for ${m}`),
      ...p.problems,
    ];
    if (why.length) { refused.push({ email: p.email, why }); continue; }
    // Read back through getSignature, so "written" means the vendor agrees it is there.
    const after = await setSignature(p.email, p.html);
    if (after.problems.length) refused.push({ email: p.email, why: after.problems });
    else written.push(p.email);
  }
  return { written, refused };
}
