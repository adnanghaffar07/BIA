/**
 * Email bodies, readable.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * The sending platform stores a body as HTML, and the editor showed it raw. A two-paragraph
 * email arrived on screen as:
 *
 *   <div>Hi {{firstName}},</div><div><br /></div><div>Your homeowners policy renews in …
 *
 * Nobody proofreads that. It is also exactly how {{ first_name }} survived in live copy
 * across eight campaigns — a wrong variable is invisible inside a wall of tags, and the
 * platform prints nothing for it, so the mistake never surfaces anywhere.
 *
 * So the editor works in plain text and the HTML lives only at the boundary: converted in on
 * load, converted out on save.
 *
 * ── Why the round trip is guarded ───────────────────────────────────────────
 * Turning HTML into text throws away anything text cannot express. For <div> and <br> that
 * costs nothing — they ARE line breaks. For a link, an image or a table it would silently
 * destroy the copy, and the person who lost it would not find out until a send.
 *
 * isSimpleHtml() decides. When it says no, the editor leaves the HTML alone and says why.
 * The guard is deliberately strict: it is far better to make somebody edit raw tags than to
 * eat a booking link on the way past.
 */

/**
 * Can this body survive a trip through plain text and back?
 *
 * Only the tags that mean "line break" are allowed, and only bare — a <div class="…"> may
 * carry styling that matters, so it is refused too. Anything else, including any attribute,
 * any entity beyond the handful below, or any tag not on this list, is a no.
 */
export function isSimpleHtml(html: string): boolean {
  const s = String(html ?? '');
  if (!s.trim()) return true;
  // Every tag in the string, as written.
  const tags = s.match(/<[^>]+>/g) ?? [];
  for (const tag of tags) {
    // Bare open/close div, p, br — with or without a self-closing slash and spaces.
    if (/^<\/?\s*(div|p|br)\s*\/?\s*>$/i.test(tag)) continue;
    return false;
  }
  return true;
}

/** The entities a plain-text editor has to be able to show and put back. */
const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0?39;|&apos;/gi, "'"],
];

/**
 * HTML in, readable text out.
 *
 * Only called when isSimpleHtml() has already agreed, so there is nothing here to lose.
 */
export function htmlToText(html: string): string {
  let s = String(html ?? '');
  if (!s.trim()) return '';

  // A <br> is a line break wherever it appears.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  // A block element ends a line. The opening tag is dropped; the closing tag breaks.
  s = s.replace(/<\s*\/\s*(div|p)\s*>/gi, '\n');
  s = s.replace(/<\s*(div|p)\s*>/gi, '');

  for (const [re, ch] of ENTITIES) s = s.replace(re, ch);

  /**
   * <div><br /></div> is one blank line, not two.
   *
   * The closing div breaks and so does the br, so a paragraph gap arrives here as three
   * newlines and would grow by one every time somebody saved. Runs of three or more collapse
   * to exactly two — one blank line — which is what the markup meant.
   */
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.replace(/\n+$/, '');
}

/**
 * Readable text in, HTML out.
 *
 * One <div> per line, and <div><br /></div> for a blank one — the shape the platform's own
 * editor produces, so copy written here and copy written there stay the same shape.
 */
export function textToHtml(text: string): string {
  const s = String(text ?? '');
  if (!s.trim()) return '';
  return s
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return '<div><br /></div>';
      // Only the three that would otherwise become markup. Quotes and apostrophes are left
      // alone: the copy is full of them and escaping makes the next read-back noisy.
      const safe = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<div>${safe}</div>`;
    })
    .join('');
}
