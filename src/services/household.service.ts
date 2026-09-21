import { insuredEmails, coInsuredEmails } from './recipients.service';

/**
 * Household identity — who counts as "the same people" (directive Sec. 11.2, 7.1).
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * The campaign tool deduplicates by email address. That is not the same question. Frank's rule is
 * "Insured and co-insured are one household. Engagement by either confirms the household
 * and stops sends to the other. Suppression, opt-out and DNC are household-level."
 *
 * An address-level tool cannot honour that: the insured replies "stop", their mailbox is
 * suppressed, and the co-insured keeps receiving the sequence from the same kitchen table.
 * From the household's point of view we did not stop, and that is the version that ends up
 * in a complaint.
 *
 * It also cannot honour the 21 Sep instruction "dedup at both levels — seven cohorts
 * pulled at different times will contain repeats". Two leads can be the same household
 * without sharing a single address: a couple where the CRM holds his email on one card and
 * hers on another.
 *
 * ── What identifies a household ─────────────────────────────────────────────
 * Two signals, and a lead belongs to a household if EITHER matches:
 *
 *   1. The property. Normalised street + ZIP. This is the strongest signal available —
 *      it is literally the same home — and it survives the lead being re-pulled under a
 *      new id, which a lead-id-based grouping would not.
 *
 *   2. A shared email address. Catches the same person appearing on two cards, which is
 *      how "repeats across cohorts" actually shows up: one owner, two properties, both
 *      pulled in different weeks. Grouping on address alone would mail them twice.
 *
 * Because signal 2 is transitive — A shares with B, B shares with C, so A, B and C are one
 * household — the grouping is a union-find rather than a GROUP BY. A GROUP BY on either
 * key alone splits exactly the households we are trying to keep together.
 *
 * ── Why the key is derived and not stored ───────────────────────────────────
 * A stored key is wrong the moment an address is corrected or a trace adds an email, and
 * it would then silently mail a household twice while every report insisted it was one.
 * Derived per run, it cannot drift. The cost is one pass over the send list, which is a
 * few thousand rows.
 */

type LeadLike = Record<string, unknown>;

const str = (v: unknown) => String(v ?? '').trim();

/**
 * Street normalisation, deliberately conservative.
 *
 * It folds the differences that are certainly the same place — case, punctuation, the usual
 * suffix abbreviations — and nothing else.
 *
 * ── The unit number STAYS ───────────────────────────────────────────────────
 * The first version of this stripped "Unit 329" along with the rest, on the reasoning that
 * unit markers are noise. They are not: they are the address. Five leads at 100 John T
 * O Leary Blvd — units 329, 411, 420, 427 and 428 — normalised to the same string and
 * collapsed into one household, so four separate condo owners were dropped from the send
 * as duplicates of the fifth.
 *
 * This book is condo-heavy, so that error scales: every condo building becomes one
 * "household" and all but one owner disappears from every cohort, with the exclusion
 * report cheerfully calling them duplicates. Mailing one house twice is a nuisance.
 * Silently deleting a building's worth of paid-for prospects is not.
 *
 * So the unit marker is CANONICALISED — apt / apartment / # / suite all become "unit" —
 * and the identifier after it is kept. Two records for unit 329 still merge; 329 and 411
 * stay apart.
 */
export function normaliseStreet(value: unknown): string {
  let s = str(value).toLowerCase();
  if (!s) return '';
  // "#329" and "# 329" are unit numbers; a bare "." or "," is punctuation.
  s = s.replace(/#\s*/g, ' unit ');
  s = s.replace(/[.,]/g, ' ');
  s = s.replace(/\b(apartment|apt|suite|ste|unit|rm|room)\b\s*/g, 'unit ');
  const suffix: Record<string, string> = {
    street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln',
    court: 'ct', place: 'pl', boulevard: 'blvd', terrace: 'ter', circle: 'cir',
    parkway: 'pkwy', highway: 'hwy', square: 'sq', trail: 'trl', way: 'way',
    north: 'n', south: 's', east: 'e', west: 'w',
  };
  s = s.split(/\s+/).map((w) => suffix[w] ?? w).join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** The address key for one lead. Empty when there is no usable address. */
export function addressKeyOf(lead: LeadLike): string {
  const street = normaliseStreet(lead.addressStreet);
  const zip = str(lead.addressZip).slice(0, 5);
  if (!street || !zip) return '';
  return `${street}|${zip}`;
}

/** Every address on the card, lower-cased — insured and co-insured alike. */
export function allEmailsOf(lead: LeadLike): string[] {
  return [...insuredEmails(lead), ...coInsuredEmails(lead)]
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
}

export type Household = {
  /** Stable within a run. Derived from the lowest lead id in the group, so it is reproducible. */
  key: string;
  leadIds: string[];
  /** Every address anywhere in the household. */
  emails: string[];
  addressKeys: string[];
};

/**
 * Group leads into households.
 *
 * Union-find over two relations: same property, or a shared email address. Returns one
 * Household per group, plus a lead-id → household lookup for the send-time check.
 */
export function groupHouseholds(leads: LeadLike[]): {
  households: Household[];
  byLeadId: Map<string, Household>;
} {
  const ids = leads.map((l) => String(l.id ?? ''));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    // Path compression — these chains get long on a big shared-email cluster.
    let c = x;
    while (parent.get(c) && parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb < ra ? rb : ra);  // lowest id wins, so the key is reproducible
  };

  for (const id of ids) parent.set(id, id);

  // Relation 1 — the same property.
  const byAddress = new Map<string, string>();
  // Relation 2 — a shared address anywhere on either card.
  const byEmail = new Map<string, string>();

  for (const l of leads) {
    const id = String(l.id ?? '');
    const ak = addressKeyOf(l);
    if (ak) {
      const seen = byAddress.get(ak);
      if (seen) union(id, seen); else byAddress.set(ak, id);
    }
    for (const e of allEmailsOf(l)) {
      const seen = byEmail.get(e);
      if (seen) union(id, seen); else byEmail.set(e, id);
    }
  }

  const groups = new Map<string, Household>();
  for (const l of leads) {
    const id = String(l.id ?? '');
    const root = find(id);
    let h = groups.get(root);
    if (!h) { h = { key: `hh:${root}`, leadIds: [], emails: [], addressKeys: [] }; groups.set(root, h); }
    h.leadIds.push(id);
    for (const e of allEmailsOf(l)) if (!h.emails.includes(e)) h.emails.push(e);
    const ak = addressKeyOf(l);
    if (ak && !h.addressKeys.includes(ak)) h.addressKeys.push(ak);
  }

  const households = [...groups.values()];
  const byLeadId = new Map<string, Household>();
  for (const h of households) for (const id of h.leadIds) byLeadId.set(id, h);
  return { households, byLeadId };
}

/**
 * The household key for a single lead, WITHOUT the cross-lead grouping.
 *
 * Used when recording a suppression: the property is the part of a household's identity
 * that is stable over time, and a suppression has to outlive the run that created it.
 * Falls back to the lead id when there is no usable address, so a suppression is never
 * silently recorded against an empty key that would match every other address-less lead.
 */
export function householdKeyOf(lead: LeadLike): string {
  const ak = addressKeyOf(lead);
  return ak ? `hh:${ak}` : `hh:lead:${String(lead.id ?? '')}`;
}
