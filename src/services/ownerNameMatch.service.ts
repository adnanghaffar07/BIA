/**
 * Owner-name matching — compares the insured name we hold against an authoritative
 * public record (municipal tax roll).
 *
 * The two sides are formatted differently and both are messy:
 *   ours   → owner1FirstName "Theresa", owner1LastName "Brummer"
 *   theirs → "BRUMMER, THERESA"   (LAST, FIRST — all caps)
 *
 * Built against the real book (1,028 owner names), which contains:
 *   219 entities with no first name ("Kasmon Llc")   148 LLC/Inc/Corp
 *    69 middle initials ("Irene C Casamento")         42 trusts
 *    18 two-person names ("Michael Tarantul & Tatyana Tarantul")
 *    15 suffixes ("Raymond Mcmanus Jr")                6 hyphenated
 *
 * Deliberately returns a GRADED result, not a boolean. A surname match with a
 * different first name is extremely common and legitimate — a tax roll often lists
 * a spouse, a co-owner, or the owners in a different order. Calling that a failure
 * would bury producers in false alarms; calling it a pass would defeat the purpose.
 * So it surfaces as 'partial' for a human to glance at.
 */

export type NameMatchResult = 'match' | 'partial' | 'mismatch' | 'unknown';

export interface NameComparison {
  result: NameMatchResult;
  /** Short, human-readable reason — shown in the UI tooltip / QC report. */
  detail: string;
  ours: string;
  theirs: string;
}

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);
const ENTITY_WORDS = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|CO|HOLDINGS|PROPERTIES|PROPERTY|LP|LLP|LTD|TRUST|ESTATE|TOWNSHIP|BOROUGH|CITY|ASSOCIATES|PARTNERS|REALTY|REVOCABLE|IRREVOCABLE|LIVING|FAMILY)\b/;
// Words that carry no identifying signal when comparing entity names.
const ENTITY_NOISE = new Set(['THE', 'LLC', 'INC', 'CORP', 'CORPORATION', 'COMPANY', 'CO', 'LP', 'LLP', 'LTD',
  'TRUST', 'REVOCABLE', 'IRREVOCABLE', 'LIVING', 'FAMILY', 'ESTATE', 'OF', 'AND', 'A']);

/** Upper-case, strip accents/punctuation, collapse whitespace. */
function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.,'`]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isEntity = (s: string) => ENTITY_WORDS.test(s);

/** Drop suffixes and single-letter middle initials — never the only real name token. */
function coreTokens(s: string): string[] {
  const toks = norm(s).split(' ').filter(Boolean).filter((t) => !SUFFIXES.has(t));
  const meaningful = toks.filter((t) => t.length > 1);
  return meaningful.length ? meaningful : toks;
}

/**
 * Split a record-side name into { first, last }. Handles "LAST, FIRST" (the tax-roll
 * convention) and plain "First Last". Returns null for entity names, which are
 * compared whole rather than by first/last.
 */
function splitPerson(raw: string): { first: string; last: string } | null {
  // NB: test the RAW string for the comma — norm() strips punctuation, so checking
  // the normalized value would never detect the "LAST, FIRST" tax-roll convention
  // and every record name would be parsed backwards.
  const rawStr = String(raw ?? '');
  if (!norm(rawStr)) return null;
  if (rawStr.includes(',')) {
    const [lastPart, firstPart = ''] = rawStr.split(',');
    return { last: coreTokens(lastPart).join(' '), first: coreTokens(firstPart).join(' ') };
  }
  const toks = coreTokens(rawStr);
  if (toks.length < 2) return { last: toks[0] ?? '', first: '' };
  return { last: toks[toks.length - 1], first: toks[0] };
}

/** Two-person records ("MICHAEL TARANTUL & TATYANA TARANTUL") → each side separately. */
function splitParties(raw: string): string[] {
  return String(raw ?? '')
    .split(/\s*(?:&| AND )\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Order-independent token overlap, used for entity names. */
function entityOverlap(a: string, b: string): number {
  const sig = (s: string) => new Set(coreTokens(s).filter((t) => !ENTITY_NOISE.has(t)));
  const A = sig(a); const B = sig(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((t) => { if (B.has(t)) hit++; });
  return hit / Math.min(A.size, B.size);
}

/** Same first name, allowing one to be an initial ("C" vs "CHARLES"). */
function firstNamesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [x, y] = a.length <= b.length ? [a, b] : [b, a];
  if (x.length === 1) return y.startsWith(x);      // initial vs full
  return x.length >= 3 && y.startsWith(x);          // ALLA vs ALLAN, nickname-ish
}

/**
 * Surnames agree. Compound surnames are spaced inconsistently between our records and
 * the tax roll — "De Vito" vs "DEVITO", "Van Dusen" vs "VANDUSEN", "Mc Grath" vs
 * "MCGRATH" — so compare with the spaces removed as well. (Real miss found while
 * sampling Howell: Michael De Vito was reported as a mismatch against DEVITO, MICHAEL.)
 */
function surnamesAgree(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const squash = (s: string) => s.replace(/\s+/g, '');
  return squash(a) === squash(b);
}

/** Edit distance, capped — we only ever care whether it is 0, 1, or "more than 1". */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Surname is one character off — a transcription variance rather than a different
 * family (real case: our "Labolt" vs the roll's "ABOLT", same first name MICHELLE).
 * Only ever used to soften a 'mismatch' to 'partial'; it never produces a match, so
 * genuinely different families (SMITH/SMYTH) still get a human's eyes rather than a tick.
 */
function surnamesNearMiss(a: string, b: string): boolean {
  if (!a || !b) return false;
  const squash = (s: string) => s.replace(/\s+/g, '');
  return withinOneEdit(squash(a), squash(b));
}

export interface RollPerson { first: string; last: string; display: string }
export interface RollOwners { person1: RollPerson | null; person2: RollPerson | null; isEntity: boolean }

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();

function toRollPerson(p: { first: string; last: string } | null): RollPerson | null {
  if (!p) return null;
  const first = titleCase(p.first);
  const last = titleCase(p.last);
  const display = [first, last].filter(Boolean).join(' ').trim();
  return display ? { first, last, display } : null;
}

/**
 * Split a tax-roll owner string into its (up to two) named people — for capturing
 * BOTH insureds (typically husband + wife) so we can reach both (Frank Jul-2026).
 *
 * The roll writes two owners in one field joined by "&", and — when they share a
 * surname, which per title they almost always do — it lists the surname once:
 *   "SCHEIDT, WOODROW W & MARY ANN"  → Woodrow Scheidt + Mary Scheidt
 *   "PEREZ, ELIOT & MARISOL"          → Eliot Perez  + Marisol Perez
 *   "MESCAL,DAMION V. & JANICE V."    → Damion Mescal + Janice Mescal
 *   "MONTANARO, MICHAEL,& GINA"       → Michael Montanaro + Gina Montanaro (stray comma)
 * When the second party carries its own surname it is used as-is:
 *   "TARANTUL, MICHAEL & TATYANA TARANTUL" → Michael + Tatyana Tarantul
 *   "SMITH, JOHN & DOE, JANE"              → John Smith + Jane Doe
 *
 * Entities (LLC / trust / municipality) are never split into people — person1/2 null,
 * isEntity true. A single owner returns person1 only. The second person inherits the
 * shared surname unless it appears explicitly with its own comma, matching how spouses
 * on title are recorded; a rare unmarried different-surname co-owner listed as bare
 * "Jane Doe" would inherit the primary surname — an accepted edge, not the common case.
 */
export function parseRollOwners(raw: string): RollOwners {
  const display = String(raw ?? '').trim();
  if (!display) return { person1: null, person2: null, isEntity: false };
  if (isEntity(display)) return { person1: null, person2: null, isEntity: true };

  const parties = splitParties(display);
  const person1 = toRollPerson(splitPerson(parties[0] ?? ''));
  if (!person1) return { person1: null, person2: null, isEntity: false };

  let person2: RollPerson | null = null;
  if (parties.length >= 2) {
    const rawP2 = parties[1];
    if (rawP2.includes(',')) {
      // Second party carries its own "LAST, FIRST" — use it verbatim.
      person2 = toRollPerson(splitPerson(rawP2));
    } else {
      // Bare given name(s): the shared surname is listed once on party 1, so inherit it.
      const toks = coreTokens(rawP2);
      if (toks.length) {
        person2 = toRollPerson({ first: toks[0], last: person1.last.toUpperCase() });
      }
    }
  }
  return { person1, person2, isEntity: false };
}

/**
 * Compare the insured name we hold against the authoritative record name.
 * `theirs` is the raw record string, e.g. "BRUMMER, THERESA".
 */
export function compareOwnerNames(
  ours: { first?: string | null; last?: string | null },
  theirs: string,
): NameComparison {
  const ourFirstRaw = String(ours.first ?? '').replace(/\bnull\b/gi, '').trim();
  const ourLastRaw = String(ours.last ?? '').trim();
  const oursDisplay = [ourFirstRaw, ourLastRaw].filter(Boolean).join(' ').trim();
  const theirsDisplay = String(theirs ?? '').trim();

  if (!oursDisplay || !theirsDisplay) {
    return { result: 'unknown', detail: 'Not enough name data to compare', ours: oursDisplay, theirs: theirsDisplay };
  }

  // ── Entity (LLC / trust / municipality) — compare whole names, not first/last.
  if (isEntity(oursDisplay) || isEntity(theirsDisplay)) {
    const score = entityOverlap(oursDisplay, theirsDisplay);
    if (score >= 0.8) return { result: 'match', detail: 'Entity name matches the tax record', ours: oursDisplay, theirs: theirsDisplay };
    if (score >= 0.4) return { result: 'partial', detail: 'Entity name partly matches — confirm on the call', ours: oursDisplay, theirs: theirsDisplay };
    return { result: 'mismatch', detail: 'Entity name does not match the tax record', ours: oursDisplay, theirs: theirsDisplay };
  }

  // ── Person. A record may list two parties; a match against either is a match.
  const ourSide = { first: coreTokens(ourFirstRaw).join(' '), last: coreTokens(ourLastRaw).join(' ') };
  const parties = splitParties(theirsDisplay);

  let best: NameComparison = { result: 'mismatch', detail: 'Name does not match the tax record', ours: oursDisplay, theirs: theirsDisplay };

  for (const party of parties) {
    const p = splitPerson(party);
    if (!p) continue;
    const lastOk = surnamesAgree(ourSide.last, p.last);
    const firstOk = firstNamesAgree(ourSide.first, p.first);

    if (lastOk && firstOk) {
      return { result: 'match', detail: 'Name matches the tax record', ours: oursDisplay, theirs: theirsDisplay };
    }
    if (lastOk && best.result !== 'partial') {
      best = {
        result: 'partial',
        detail: p.first
          ? `Surname matches, but the record shows "${p.first}" — could be a spouse or co-owner`
          : 'Surname matches the tax record',
        ours: oursDisplay, theirs: theirsDisplay,
      };
    }
    // Same first name but the surname is a single character off — treat as a spelling
    // variance needing a look, not as a different person.
    if (!lastOk && firstOk && surnamesNearMiss(ourSide.last, p.last) && best.result !== 'partial') {
      best = {
        result: 'partial',
        detail: `Spelling differs — we have "${ourSide.last}", the record shows "${p.last}". Confirm on the call.`,
        ours: oursDisplay, theirs: theirsDisplay,
      };
    }
  }
  return best;
}
