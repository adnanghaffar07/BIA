import { insuredEmails, coInsuredEmails } from './recipients.service';

/**
 * Which ONE address to write to for a given person.
 *
 * This implements Section 04 of the Grade A Outreach Playbook (locked 9/14) — Frank's
 * addressing policy — and it replaces "mail every address we hold".
 *
 * The policy in his words: "A lead card is not six email addresses. It is up to two
 * people — insured and co-insured — each with up to three candidate addresses. We cannot
 * know which inbox is primary and no vendor can tell us, so the answer is not a lookup:
 * it is a ranking plus a feedback loop." The send rule is one address per person per
 * touch, the top-ranked surviving one, never two at once.
 *
 * ── The five signals, in the playbook's own order of authority ───────────────
 * A higher signal always outranks every lower one, so the weights are tiered rather
 * than additive-in-spirit: a valid address with a weak name match still beats an
 * unverified address with a strong one.
 *
 *  1. VERIFICATION   valid >> catch-all >> unknown. Invalid is excluded outright,
 *                    never queued. NOT YET AVAILABLE — no verification vendor has been
 *                    chosen (register A25). Until one is, every address scores
 *                    'unknown' and the ranking falls through to signal 2.
 *  2. OWNER NAME     does the local part look like the insured's name? Strong / partial
 *                    / none, from the name we hold and the tax-roll check.
 *  3. PROVIDER       Tracerfy returns rank 1..n per address. Available today.
 *  4. DOMAIN CLASS   Gmail > iCloud/Outlook > Yahoo/AOL (older, often dormant) >
 *                    corporate. "Never prefer a work address for a personal insurance
 *                    solicitation."
 *  5. ENGAGEMENT     a hard bounce demotes permanently; a reply or click promotes
 *                    decisively. Empty on cycle one, decisive by cycle two.
 *
 * ── Fallback ────────────────────────────────────────────────────────────────
 * "Fall back on hard bounce only. A hard bounce promotes rank 2 for that person at the
 * next touch. Silence does not — silence is a signal about the message, not about the
 * address." Hard-bounced addresses are therefore removed from the pool, which makes the
 * old rank 2 the new rank 1 without any special case.
 *
 * "Never rank 3 or below unless ranks 1 and 2 both hard-bounced, and even then only on a
 * lead scoring strong on person-match" — enforced in bestAddress().
 */

export type VerificationStatus = 'valid' | 'catch_all' | 'unknown' | 'invalid';

/** Facts about addresses that live outside the lead row, supplied by the caller. */
export type AddressSignals = {
  /** Addresses that have hard-bounced anywhere. Excluded permanently. */
  hardBounced?: Set<string>;
  /** Addresses that replied or clicked. Promoted decisively. */
  engaged?: Set<string>;
  /** Verifier result per address. Absent until a vendor is chosen (A25). */
  verification?: Map<string, VerificationStatus>;
};

export type RankedAddress = {
  email: string;
  score: number;
  /** Why it scored what it did — the weekly review has to be able to audit a choice. */
  reasons: string[];
  /** Position in the surviving pool, 1 = the one we would send to. */
  rank: number;
};

/** Tiered so a higher signal can never be outweighed by the sum of lower ones. */
const W = {
  engaged: 10_000,
  verifyValid: 1_000,
  verifyCatchAll: 500,
  nameStrong: 100,
  namePartial: 50,
  provider: 10,      // × (10 - vendorRank), so rank 1 = 90, rank 2 = 80 …
  domainGmail: 8,
  domainMajor: 6,
  domainLegacy: 3,
  domainCorporate: 1,
};

const LEGACY = /^(yahoo|aol|cs|juno|netzero|earthlink|optonline|comcast|verizon|sbcglobal|att)\./;
const MAJOR = /^(icloud|me|mac|outlook|hotmail|live|msn)\./;

function domainScore(email: string): [number, string] {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain.startsWith('gmail.')) return [W.domainGmail, 'gmail'];
  if (MAJOR.test(domain)) return [W.domainMajor, 'icloud/outlook'];
  if (LEGACY.test(domain)) return [W.domainLegacy, 'legacy consumer domain'];
  // Anything else is almost always a workplace domain. The playbook is explicit that a
  // work address is the last thing to use for a personal insurance approach.
  return [W.domainCorporate, 'likely work address'];
}

/** How much the local part looks like the person we mean to reach. */
function nameScore(email: string, first?: string | null, last?: string | null): [number, string] {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  const f = String(first ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const l = String(last ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!local || (!f && !l)) return [0, 'no name to match'];

  const hasF = f.length >= 3 && local.includes(f);
  const hasL = l.length >= 3 && local.includes(l);
  if (hasF && hasL) return [W.nameStrong, 'name match: first + last'];
  if (hasL) return [W.nameStrong, 'name match: last'];
  // A lone first name is weaker — "john@" could be any John in the household.
  if (hasF) return [W.namePartial, 'name match: first only'];
  // Initial + surname, the commonest real-world shape (jsmith@).
  if (f && l.length >= 3 && local.startsWith(f[0]) && local.includes(l)) {
    return [W.nameStrong, 'name match: initial + last'];
  }
  return [0, 'no name match'];
}

/** The vendor's own confidence, where we captured it. Lower vendor rank = better. */
function providerRank(lead: any, email: string): number | null {
  const persons = Array.isArray(lead?.skipTraceData?.persons) ? lead.skipTraceData.persons : [];
  for (const p of persons) {
    const list = Array.isArray(p?.emails) ? p.emails : [];
    for (const e of list) {
      const addr = String(typeof e === 'string' ? e : e?.email ?? '').trim().toLowerCase();
      if (addr === email && typeof e?.rank === 'number') return e.rank;
    }
  }
  return null;
}

/**
 * Score and order one person's candidate addresses, best first.
 *
 * Invalid and hard-bounced addresses are removed rather than ranked low: the playbook
 * says invalid is "excluded outright, never queued", and a hard bounce "demotes
 * permanently". Something scored last would still be sent on a card where it is the only
 * survivor, which is precisely what must not happen.
 */
export function rankAddresses(
  emails: string[],
  lead: any,
  first: string | null | undefined,
  last: string | null | undefined,
  signals: AddressSignals = {},
): RankedAddress[] {
  const scored: RankedAddress[] = [];

  for (const raw of emails) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!email) continue;

    const verification = signals.verification?.get(email) ?? 'unknown';
    if (verification === 'invalid') continue;
    if (signals.hardBounced?.has(email)) continue;

    let score = 0;
    const reasons: string[] = [];

    if (signals.engaged?.has(email)) { score += W.engaged; reasons.push('engaged previously'); }

    if (verification === 'valid') { score += W.verifyValid; reasons.push('verified valid'); }
    else if (verification === 'catch_all') { score += W.verifyCatchAll; reasons.push('catch-all domain'); }
    else reasons.push('not verified');

    const [nScore, nWhy] = nameScore(email, first, last);
    score += nScore; reasons.push(nWhy);

    const pRank = providerRank(lead, email);
    if (pRank != null) {
      score += Math.max(W.provider * (10 - pRank), 0);
      reasons.push(`vendor rank ${pRank}`);
    } else {
      // Producer-entered addresses carry no vendor rank. Treat them as mid-confidence
      // rather than last: somebody typed it in for a reason.
      score += W.provider * 5;
      reasons.push('entered in the CRM');
    }

    const [dScore, dWhy] = domainScore(email);
    score += dScore; reasons.push(dWhy);

    scored.push({ email, score, reasons, rank: 0 });
  }

  scored.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));
  scored.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}

/**
 * The single address to use for this person on this touch, or null.
 *
 * Returns null rather than reaching past rank 2 on a weak card: "Never rank 3 or below
 * unless ranks 1 and 2 both hard-bounced, and even then only on a lead scoring strong on
 * person-match." A card whose first two addresses died and whose remaining address does
 * not look like the insured is more likely to be a stranger than a customer.
 */
export function bestAddress(
  emails: string[],
  lead: any,
  first: string | null | undefined,
  last: string | null | undefined,
  signals: AddressSignals = {},
): RankedAddress | null {
  const ranked = rankAddresses(emails, lead, first, last, signals);
  if (!ranked.length) return null;

  const top = ranked[0];
  // How many of this person's addresses were removed as hard bounces tells us how deep
  // into the pool this survivor actually sits.
  const burned = emails.filter((e) => signals.hardBounced?.has(String(e).trim().toLowerCase())).length;
  if (burned >= 2) {
    const strong = top.reasons.some((r) => r.startsWith('name match:') && !r.includes('first only'));
    if (!strong) return null;
  }
  return top;
}

/** The one address for the named insured on this touch. */
export function bestInsuredAddress(lead: any, signals: AddressSignals = {}): RankedAddress | null {
  return bestAddress(insuredEmails(lead), lead, lead?.owner1FirstName, lead?.owner1LastName, signals);
}

/** The one address for the co-insured. Per the playbook this is an E2 address, not an E1 one. */
export function bestCoInsuredAddress(lead: any, signals: AddressSignals = {}): RankedAddress | null {
  return bestAddress(coInsuredEmails(lead), lead, lead?.owner2FirstName, lead?.owner2LastName, signals);
}
