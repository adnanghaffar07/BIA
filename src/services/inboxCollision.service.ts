/**
 * One inbox, two houses — deciding which one gets mailed (§1.5, §7.1).
 *
 * ── The mismatch this exists to resolve ─────────────────────────────────────
 * Our identity for a contact is a PERSON ON A PROPERTY. The sending platform's identity is
 * an EMAIL ADDRESS: a contact is one row keyed by address, and every custom variable —
 * street_address, renewal_date, band_high — hangs off that row.
 *
 * Where the two disagree, a value lands on the wrong house. Three addresses on the current
 * send list disagree:
 *
 *   hemantgandhi@hotmail.com   3307 Charleston Dr (C2)  +  91 Augustus Dr (C7)  — owns both
 *   spranita@hotmail.com       3307 Charleston Dr (C2)  +  91 Augustus Dr (C7)  — co-insured
 *   ramupedada@gmail.com       3303 Expedition St       +  3304 Expedition St   — neighbours
 *
 * ── Why "the platform will just dedupe it" is not an answer ─────────────────
 * It keeps ONE row for the address and the surviving values are whichever upload landed
 * last. Row order in a CSV is not a decision anybody made, and the failure is invisible:
 * the email sends perfectly, describing the wrong house, with the wrong renewal date, to
 * somebody who owns both and cannot tell us apart from a scam.
 *
 * ── Why "skip the duplicate" is not an answer either ────────────────────────
 * That is what the push already did, silently. It is SAFE — no wrong data goes out — but it
 * means Hemant Gandhi owns two homes and only ever hears about one, permanently, because
 * the same address collides on every future run too.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Mail the SOONEST renewal now and HOLD the rest for their own cohort. Nothing is dropped;
 * it moves. The Gandhis hear about Charleston Dr in C2 and about Augustus Dr in C7, which is
 * what should have happened in the first place.
 *
 * Held rows are returned, never discarded quietly, because a contact that vanishes between
 * the send list and the file is the kind of thing that gets noticed a quarter later.
 */

export type InboxKeyed = {
  /** Lower-cased before comparison; the platform is not case-sensitive about addresses. */
  email: string;
  /** 'YYYY-MM-DD'. Compared as text, which sorts correctly for this format. */
  renewalDate: string;
  role: string;
  propertyId: string;
  /** The send week. Two rows in the SAME cohort cannot be separated by waiting. */
  cohort: string;
};

export type Held<T> = {
  row: T;
  /** The row that won the inbox, so a report can say who it lost to. */
  keptInstead: T;
  reason: string;
  /**
   * The held row sits in a LATER cohort than the one that won.
   *
   * This is a FACT, not a reassurance, and the difference cost a wrong message once: it
   * looked like the held row would simply be mailed in its own wave. It will not, unless
   * that wave is uploaded as a SEPARATE campaign — and C4 through C7 currently go into one.
   * Both Gandhi houses are in that single upload, so deferring the C7 one defers it to
   * nothing.
   *
   * So this flag says only "a later send could pick this up IF the waves are split". It does
   * not say the property is safe, and `needsDecision` deliberately ignores it.
   */
  laterCohort: boolean;
};

export type Resolution<T> = {
  keep: T[];
  held: Held<T>[];
  /** Addresses that had to be resolved at all — for the run report. */
  collisions: number;
  /**
   * Distinct properties this resolution leaves unmailed.
   *
   * Every hold between two DIFFERENT properties counts, whatever their cohorts. Within one
   * upload there is no later wave — that is what "one upload" means — so a deferred row is
   * a dropped row until somebody splits the waves or picks a different address.
   *
   * Excludes the harmless case: two people of one household on one inbox, where sending
   * once loses nothing.
   */
  needsDecision: Held<T>[];
};

/**
 * Which of two contacts sharing an inbox gets mailed.
 *
 * Every tiebreak is deterministic ON PURPOSE. The same send list must produce the same file
 * twice, or a re-run silently swaps which house is being talked about — and re-runs happen
 * (the list was re-cut three times in one week). Falling back to input order would make that
 * depend on the row order of a SQL result, which carries no guarantee at all.
 */
function betterOf<T>(a: T, b: T, read: (t: T) => InboxKeyed): T {
  const x = read(a);
  const y = read(b);

  // 1. Soonest renewal. It is the only tiebreak with a reason behind it: the other house
  //    still has time to be mailed in its own cohort, this one may not.
  if (x.renewalDate !== y.renewalDate) return x.renewalDate < y.renewalDate ? a : b;

  // 2. The insured over the co-insured. §1.5 mails both, but the policy is in the insured's
  //    name, so if only one of them can have the inbox it should be the one the policy names.
  const ins = (r: InboxKeyed) => (r.role === 'insured' ? 0 : 1);
  if (ins(x) !== ins(y)) return ins(x) < ins(y) ? a : b;

  // 3. Property id, purely so the answer is stable. No meaning is claimed for it.
  return String(x.propertyId) <= String(y.propertyId) ? a : b;
}

export function resolveInboxCollisions<T>(rows: T[], read: (t: T) => InboxKeyed): Resolution<T> {
  const byEmail = new Map<string, T[]>();
  for (const r of rows) {
    const key = String(read(r).email ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = byEmail.get(key);
    if (list) list.push(r); else byEmail.set(key, [r]);
  }

  const keep: T[] = [];
  const held: Held<T>[] = [];
  let collisions = 0;

  for (const [, list] of byEmail) {
    if (list.length === 1) { keep.push(list[0]); continue; }
    collisions++;

    const winner = list.reduce((best, r) => betterOf(best, r, read));
    keep.push(winner);

    const w = read(winner);
    for (const r of list) {
      if (r === winner) continue;
      const k = read(r);

      // Same house, both people on one inbox: two emails about one renewal to one person
      // reads as a mailing list, not a broker. Nothing is lost by sending one.
      if (k.propertyId === w.propertyId) {
        held.push({
          row: r,
          keptInstead: winner,
          reason: `shares an inbox with the ${w.role} on the same property — one email per household`,
          laterCohort: false,
        });
        continue;
      }

      /**
       * Two different houses on one inbox. This property is not in the file.
       *
       * The first version of this said "held for its own cohort" whenever the held row sat
       * in a later wave, which read as a schedule. It is not one. Every row here is inside
       * ONE upload, and the platform keeps one contact per address per upload — so a later
       * cohort in the same file is still a house that never gets written to. Both Gandhi
       * properties are C4 and C7, and C4 through C7 go up as a single campaign.
       *
       * A later cohort only helps if that wave is uploaded separately, which is a decision
       * nobody has made. So the sentence says what is true — this one is not mailed — and
       * names the split as the way out rather than assuming it.
       */
      const laterCohort = k.cohort > w.cohort;
      held.push({
        row: r,
        keptInstead: winner,
        reason: laterCohort
          ? `shares an inbox with ${w.propertyId} (renews ${w.renewalDate}, cohort ${w.cohort}). NOT mailed by this upload — it would only be reached if ${k.cohort} is uploaded as its own campaign.`
          : `shares an inbox with ${w.propertyId} (renews ${w.renewalDate}) in the same cohort ${k.cohort}. NOT mailed — waiting cannot separate them.`,
        laterCohort,
      });
    }
  }

  return {
    keep,
    held,
    collisions,
    // Same-property holds lose nothing; every other hold is a house going unwritten-to.
    needsDecision: held.filter((h) => read(h.row).propertyId !== read(h.keptInstead).propertyId),
  };
}
