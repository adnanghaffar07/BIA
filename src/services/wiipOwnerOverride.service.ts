import { sql } from '@/lib/neon';
import { addActivity } from './storage.service';
import { parseRollOwners, compareOwnerNames, type NameMatchResult } from './ownerNameMatch.service';

/**
 * The tax roll already told us who the co-insured is. Nothing was reading it.
 *
 * ── What was actually wrong ─────────────────────────────────────────────────
 * ownerVerifyName holds the whole municipal record — "SCOTTO, DIANE & MICHAEL" — and
 * parseRollOwners has been able to split it into two people for months. No code ever wrote
 * the second person onto the card. So 87 households had a named co-insured sitting on their
 * own record while the CRM showed one owner, skip traced one owner and emailed one owner.
 * Frank raised Michael Scotto and Elizabeth Zaravelis by name on 30 Sep as cards where "the
 * co-insured is not correctly being skiptraced or overridden" — both are in that 87, and on
 * both the answer was already in the field.
 *
 * ── Why a proposal and not a write ──────────────────────────────────────────
 * Frank, 1 Oct 2026: auto-apply "only on an exact address match with overlapping names
 * (first and last reversed counts). A different owner gets flagged to me, not written." He
 * set the go-ahead for that at the Friday noon meeting. So every candidate is recorded
 * either way and applying is a separate, explicit act — proposeOwnerOverrides never writes.
 *
 * ── Why the grading matters more than the parsing ───────────────────────────
 * A raw string comparison called 99 cards a conflict. Most are the same person written
 * differently: "Margaret A Maloney" against "MALONEY, MARGARET", or "Krishnakumari"
 * truncated to "Krishnaku" by a field width in the roll. Only a real mismatch — "Carole
 * Gennusa" against "Christopher Gigl" — is worth Frank's time, and burying those few in a
 * list of ninety is the same as not reporting them. compareOwnerNames already grades this
 * against a corpus of 1,028 real owner names, so it is used rather than re-invented.
 */

export type OverrideState = 'applied' | 'flagged' | 'reverted';

export interface OwnerProposal {
  leadId: string;
  cohort: string | null;
  grade: string | null;
  role: 'insured' | 'coInsured';
  rollName: string;
  from: { first: string; last: string };
  to: { first: string; last: string };
  nameMatch: NameMatchResult;
  /** Safe to write without a human, under Frank's rule. */
  autoApplicable: boolean;
  reason: string;
}

const txt = (v: unknown) => String(v ?? '').trim();
const same = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');

/**
 * ── A roll name without a comma does not say which way round it is ──────────
 *
 * The parser reads "LAST, FIRST" when there is a comma and falls back to "FIRST LAST"
 * when there is not. North Brunswick's roll writes neither — it is "LAST FIRST" with no
 * punctuation at all:
 *
 *     "OCHOA DEBORA E"    card holds Debora Ochoa    — the card is right
 *     "ELLIOTT FRANK H"   card holds Frank Elliott   — the card is right
 *     "CAGAOAN SHAUN"     card holds Shaun Cagaoan   — the card is right
 *
 * Read with the fallback those parse backwards, and each one then looks exactly like the
 * reversal Frank asked us to auto-apply: "names overlap (Ashraf Waqas ↔ Waqas Ashraf)".
 * Applying them would have rewritten five correct cards into wrong ones and then sent the
 * wrong first name to a skip-trace vendor — the precise failure he raised the rule to stop.
 *
 * His rule still holds for what it was about: a reversal is the SAME PERSON, not a
 * different owner, so these are never reported to him as a stranger on the deed. But which
 * order is correct is not something the record answers, so it is not something we guess.
 * 13 of 443 roll names are comma-less; they are flagged for a human with the reason said
 * out loud. The remaining 430 are unaffected.
 */
const orderIsAmbiguous = (rollName: string) => !String(rollName ?? '').includes(',');

/**
 * ── When the second owner brought their own surname ─────────────────────────
 *
 * parseRollOwners takes the second party's first token and inherits the surname from the
 * first, because spouses on title share one and the roll prints it once: "PEREZ, ELIOT &
 * MARISOL" is Eliot and Marisol Perez. Its own docstring accepts the cost — "a rare
 * unmarried different-surname co-owner listed as bare 'Jane Doe' would inherit the primary
 * surname — an accepted edge".
 *
 * That cost was fine while the parse only fed a display and a comparison. It is not fine
 * now that the answer gets written onto the card and then handed to a skip-trace vendor:
 * "Ronghui LI & Yanfeng Chen" yielded a co-insured of "Yanfeng Li", a person the record
 * never mentions and nobody can trace.
 *
 * So where the bare second party carries two or more name tokens, its own last token is
 * taken as the surname. On the shared-surname case it changes nothing — "TATYANA TARANTUL"
 * still gives Tarantul — and on the different-surname case it stops inventing somebody.
 * A single bare token ("& MARISOL") still inherits, which is the common shape and the one
 * the inheritance rule was written for.
 */
export function secondParty(
  rollName: string,
  fallback: { first: string; last: string },
): { first: string; last: string; certain: boolean } {
  const parties = String(rollName ?? '').split(/\s*(?:&| AND )\s*/i).map((s) => s.trim()).filter(Boolean);
  const raw = parties[1];
  if (!raw || raw.includes(',')) return { ...fallback, certain: true };
  const toks = raw.split(/\s+/).map((t) => t.replace(/[^A-Za-z-]/g, '')).filter((t) => t.length > 1);
  if (toks.length < 2) return { ...fallback, certain: true };
  const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  /**
   * Better than inheriting, but still a reading rather than a fact — so `certain` is false
   * and nothing here applies itself.
   *
   * "& TATYANA TARANTUL" is plainly a surname. "& MARY JANE" is plainly not. "& MUSAIB
   * AHMED SYED" could be either, and the record does not say. Guessing right most of the
   * time is the wrong target when the output is written to a card and then handed to a
   * vendor as the person to find: the cost of a wrong surname is a paid trace on somebody
   * who does not exist, which is the bill Frank already queried once.
   */
  return { first: title(toks[0]), last: title(toks[toks.length - 1]), certain: false };
}

/** Same two tokens, opposite order — the same human being, written the other way round. */
const isReversal = (a: { first: string; last: string }, b: { first: string; last: string }) => {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  return !!k(a.first) && !!k(a.last) && k(a.first) === k(b.last) && k(a.last) === k(b.first);
};

/**
 * What the roll says the card should hold, for every lead that has been WIIP-checked.
 *
 * Read-only. Entities are skipped entirely — an LLC or a trust has no co-insured to reach,
 * and splitting one into "people" would invent a human being to email.
 */
export async function proposeOwnerOverrides(opts: {
  cohorts?: string[]; grade?: string;
} = {}): Promise<OwnerProposal[]> {
  const cohorts = opts.cohorts ?? [];
  const grade = opts.grade ?? '';
  const rows = await sql`
    SELECT "id", "cohort", "grade", "owner1FirstName", "owner1LastName",
           "owner2FirstName", "owner2LastName", "ownerVerifyName", "ownerVerifyStatus"
      FROM "Lead"
     WHERE "ownerVerifyName" IS NOT NULL AND "ownerVerifyName" <> ''
       AND (${cohorts.length === 0} OR "cohort"::text = ANY(${cohorts}::text[]))
       AND (${grade === ''} OR "grade" = ${grade})` as Array<Record<string, any>>;

  const out: OwnerProposal[] = [];
  for (const l of rows) {
    const roll = parseRollOwners(l.ownerVerifyName);
    if (roll.isEntity || !roll.person1) continue;
    const base = {
      leadId: String(l.id),
      cohort: l.cohort ? String(l.cohort) : null,
      grade: l.grade ?? null,
      rollName: String(l.ownerVerifyName),
    };

    /**
     * The insured, when the roll disagrees with the card.
     *
     * Frank's Waqas Ashraf lives here: WIIP read it as Ashraf Waqas, the card was never
     * updated, and the skip trace went out on the reversed name — his words, "wasted $
     * skiptracing & professional email to wrong first name".
     */
    const ourFirst = txt(l.owner1FirstName);
    const ourLast = txt(l.owner1LastName);
    const cardHoldsOtherOwner = !!roll.person2?.display
      && same(ourFirst + ourLast, roll.person2.display);
    if (roll.person1.display && !same(ourFirst + ourLast, roll.person1.display)) {
      const cmp = compareOwnerNames({ first: ourFirst, last: ourLast }, String(l.ownerVerifyName));
      const reversed = isReversal({ first: ourFirst, last: ourLast }, roll.person1);
      const ambiguous = orderIsAmbiguous(base.rollName);
      /**
       * ── The card already names the OTHER owner ────────────────────────────
       *
       * compareOwnerNames is handed the whole roll line, both parties in it, so a card
       * holding the second owner grades as a clean "match" against it. On "IQBAL, SUMAIYA
       * & MUSAIB AHMED SYED" the card holds Musaib Syed, and the proposal was to rewrite
       * the insured to Sumaiya Iqbal — while the co-insured proposal filled Musaib in
       * underneath. The two together swap husband and wife.
       *
       * Nothing would have looked broken afterwards: both people are on the card and both
       * names are real. But which one is the NAMED INSURED is a fact about the policy, not
       * a detail of presentation — it decides who the email opens to and who Ruben asks
       * for. The roll lists owners in the county's order, which is not the policy's. So a
       * swap is surfaced and never performed.
       */
      out.push({
        ...base,
        role: 'insured',
        from: { first: ourFirst, last: ourLast },
        to: { first: roll.person1.first, last: roll.person1.last },
        // A reversal is the same person however the roll chose to print it.
        nameMatch: reversed ? 'match' : cmp.result,
        autoApplicable: cardHoldsOtherOwner
          ? false
          : reversed
            ? !ambiguous
            : cmp.result === 'match' || cmp.result === 'partial',
        reason: cardHoldsOtherOwner
          ? 'The card names the other owner on this deed. Swapping who the named insured '
            + 'is changes who the email opens to, so this is for a person to decide.'
          : reversed && ambiguous
          ? 'Same two names, opposite order, and this roll writes no comma — so the record '
            + 'does not say which is the surname. Same person, not a different owner; needs '
            + 'an eye before the card is rewritten.'
          : reversed
            ? 'The roll gives the same name in the other order.'
            : cmp.result === 'mismatch'
              ? `The roll names a different person (${cmp.detail}). Flagged, not written.`
              : `Roll spelling differs from the card (${cmp.detail}).`,
      });
    }

    // ── The co-insured ──────────────────────────────────────────────────────
    if (!roll.person2?.display) continue;
    /**
     * Which of the two on the deed is the co-insured depends on which one the card already
     * calls the insured. On "SCOTTO, DIANE & MICHAEL" the card's insured is Michael, so the
     * co-insured is DIANE — taking the roll's second party here would have written Michael
     * into both slots and left Diane, the person Frank asked after, still missing.
     */
    const co2 = cardHoldsOtherOwner && roll.person1
      ? { first: roll.person1.first, last: roll.person1.last, certain: true }
      : secondParty(base.rollName, { first: roll.person2.first, last: roll.person2.last });
    const co2Display = [co2.first, co2.last].filter(Boolean).join(' ').trim();
    const coFirst = txt(l.owner2FirstName);
    const coLast = txt(l.owner2LastName);

    if (!coFirst && !coLast) {
      /**
       * Nothing to contradict, so nothing to weigh. A second name on the municipal record
       * is the best evidence there is that a second person lives there, and the card
       * currently claims nobody. Frank's "different owner" guard protects an existing
       * value; here there isn't one.
       */
      /**
       * Except on a comma-less roll, where the second party's surname is INHERITED from a
       * first party we may have split backwards. "GOHEL SURIL & GADHIA HETU" yields a
       * co-insured of "Gadhia Suril" — a person who does not exist. The gain is real on the
       * 430 rolls that punctuate; it is a guess on the 13 that do not.
       */
      const ambiguous = orderIsAmbiguous(base.rollName);
      out.push({
        ...base,
        role: 'coInsured',
        from: { first: '', last: '' },
        to: { first: co2.first, last: co2.last },
        nameMatch: 'unknown',
        autoApplicable: !ambiguous && co2.certain,
        reason: !co2.certain
          ? 'The roll names a second owner, but writes their name without a comma, so '
            + 'whether the last word is a surname or a second given name is not stated.'
          : ambiguous
          ? 'The roll names a second owner, but writes no comma, so the surname this name '
            + 'inherits may be the wrong half of the first owner. Needs an eye.'
          : 'The roll names a second owner and the card has none.',
      });
      continue;
    }

    if (same(coFirst + coLast, co2Display)) continue;
    const cmp = compareOwnerNames({ first: coFirst, last: coLast }, co2Display);
    const coReversed = isReversal({ first: coFirst, last: coLast }, co2);
    const coAmbiguous = orderIsAmbiguous(base.rollName);
    out.push({
      ...base,
      role: 'coInsured',
      from: { first: coFirst, last: coLast },
      to: { first: co2.first, last: co2.last },
      nameMatch: coReversed ? 'match' : cmp.result,
      // Same guard as the insured above: a comma-less roll cannot settle the order, and
      // overwriting a co-insured the card already names is the costlier direction to be
      // wrong in — that name is what the vendor is asked about.
      autoApplicable: coAmbiguous || !co2.certain
        ? false
        : coReversed || cmp.result === 'match' || cmp.result === 'partial',
      reason: coAmbiguous
        ? 'This roll writes no comma, so which half is the surname is not stated. Not '
          + 'rewriting a co-insured the card already names on a guess.'
        : coReversed
          ? 'The roll gives the same co-insured in the other order.'
          : cmp.result === 'mismatch'
            ? `The roll names a different co-owner (${cmp.detail}). Flagged, not written.`
            : `Roll spelling differs from the card (${cmp.detail}).`,
    });
  }
  return out;
}

/**
 * Write the safe ones, and record every one — applied or not.
 *
 * `dryRun` defaults to true deliberately. Until Frank gives the go-ahead this should be
 * runnable by anybody who wants to see the effect without having caused it.
 */
export async function applyOwnerOverrides(
  proposals: OwnerProposal[],
  opts: { by?: string; dryRun?: boolean } = {},
): Promise<{ applied: number; flagged: number; skipped: number }> {
  const by = opts.by ?? 'wiip-override';
  const dryRun = opts.dryRun !== false;
  let applied = 0;
  let flagged = 0;
  let skipped = 0;

  for (const p of proposals) {
    if (dryRun) {
      if (p.autoApplicable) applied++; else flagged++;
      continue;
    }

    if (p.autoApplicable) {
      /**
       * Guarded on the value we read. Between proposing and applying, a producer may have
       * typed the name themselves, and overwriting that would be the silent clobber this
       * whole file exists to prevent.
       */
      const res = (p.role === 'insured'
        ? await sql`UPDATE "Lead"
                       SET "owner1FirstName" = ${p.to.first}, "owner1LastName" = ${p.to.last},
                           "updatedAt" = NOW()
                     WHERE "id" = ${p.leadId}
                       AND COALESCE("owner1FirstName", '') = ${p.from.first}
                       AND COALESCE("owner1LastName", '') = ${p.from.last}
                 RETURNING "id"`
        : await sql`UPDATE "Lead"
                       SET "owner2FirstName" = ${p.to.first}, "owner2LastName" = ${p.to.last},
                           "updatedAt" = NOW()
                     WHERE "id" = ${p.leadId}
                       AND COALESCE("owner2FirstName", '') = ${p.from.first}
                       AND COALESCE("owner2LastName", '') = ${p.from.last}
                 RETURNING "id"`) as Array<Record<string, any>>;
      if (!res.length) { skipped++; continue; }
      applied++;
    } else flagged++;

    await sql`
      INSERT INTO "OwnerOverride" ("id", "leadId", "role", "fromFirst", "fromLast",
                                   "toFirst", "toLast", "rollName", "state", "reason",
                                   "nameMatch", "decidedBy")
      VALUES (${crypto.randomUUID()}, ${p.leadId}, ${p.role}, ${p.from.first}, ${p.from.last},
              ${p.to.first}, ${p.to.last}, ${p.rollName},
              ${p.autoApplicable ? 'applied' : 'flagged'}, ${p.reason}, ${p.nameMatch}, ${by})`;

    /**
     * ── And on the card's own timeline ───────────────────────────────────
     *
     * The OwnerOverride row is the audit trail, and it is in a table nobody opens. A
     * producer looking at a lead that gained a co-insured overnight had no way to see
     * where the name came from — it simply appeared, which is exactly how people stop
     * trusting a field. Frank asked the same question of the blast traces in September:
     * "would that have been noted on the activity log?"
     *
     * Written after the override row rather than before, so the timeline cannot show a
     * change the audit trail has no record of. The reverse would be worse: a card
     * claiming something happened with nothing behind it.
     */
    const who = p.role === 'insured' ? 'Insured' : 'Co-insured';
    const was = `${p.from.first} ${p.from.last}`.trim();
    const nowName = `${p.to.first} ${p.to.last}`.trim();
    await addActivity(
      p.leadId,
      'owner_verify',
      p.autoApplicable
        ? `${who} ${was ? `changed from "${was}" to` : 'set to'} "${nowName}" `
          + `from the municipal tax roll — roll reads "${p.rollName}"`
        : `${who} flagged against the tax roll: ${p.reason}`,
      {
        source: 'wiip',
        role: p.role,
        from: was || null,
        to: nowName,
        rollName: p.rollName,
        nameMatch: p.nameMatch,
        applied: p.autoApplicable,
      },
      by,
    );
  }
  return { applied, flagged, skipped };
}
