import { sql } from '@/lib/neon';
import { parseRollOwners } from './ownerNameMatch.service';
import { ownerEntityOf } from '@/lib/ownerEntity';

/**
 * Cards where two people were crammed into the surname field and nobody can be traced.
 *
 * ── What is actually wrong ──────────────────────────────────────────────────
 * 135 leads hold the whole deed line in owner1LastName with owner1FirstName null:
 *
 *     "Prabu Arichandran & Naveena Devi Radha R"
 *     "Narayanan,D & Venkitaramanan,N"
 *     "Michael Puglisi & Karen Puglisi Joint Re"
 *
 * Every one of them is refused by the skip trace, which needs a first and last name — so
 * 78 cards of a workable grade have never been traced and never could be. That is not a
 * theory about why contact rates are low; it is 78 households the system cannot look up.
 * They also render into email as "Hi ," and into the dialler with no name to ask for.
 *
 * ── Why the first party is the one to take ──────────────────────────────────
 * 19 of the 78 are cut at exactly 40 characters, which is the source field's width. The
 * truncation only ever lands on the SECOND party — "Renee Elizabeth Plexousakis & James
 * Erne" has a complete first owner and a half-written second. So the insured is
 * recoverable on a card whose co-owner is not, and refusing the whole row because its tail
 * is damaged would throw away the name we came for.
 *
 * The second owner is only proposed when the string is NOT truncated, because on a cut
 * string "Karen Puglisi Joint Re" is not a person.
 *
 * ── Two conventions in one column ───────────────────────────────────────────
 * "Narayanan,D & Venkitaramanan,N" is LAST,FIRST. "Arnold Williams & Diana Nelson Williams"
 * is natural order. splitPerson inside parseRollOwners already keys on the comma to tell
 * them apart, which is why this reuses it rather than writing a third name parser.
 *
 * ── Nothing is applied here ─────────────────────────────────────────────────
 * Which of two names on a deed is the NAMED INSURED is a fact about the policy, not about
 * the string — the same reason the WIIP override surfaces a swap instead of performing one.
 * This proposes; a human decides.
 */

export type RepairConfidence =
  /** Full first and last name, nothing truncated. */
  | 'clear'
  /** Recoverable, but the first name is a single initial — weak input for a vendor. */
  | 'initial_only'
  /** First owner intact, second cut off by the source's 40-character field. */
  | 'second_truncated'
  /** Parsed into something that is not a name. Never applied without a human. */
  | 'suspect'
  /** A trust or company. Never split into people. */
  | 'entity';

/**
 * ── Guards that keep the "clear" bucket worth trusting ──────────────────────
 *
 * The first run of this produced plausible-looking nonsense on a minority of rows, and
 * plausible is the dangerous kind: a reviewer scanning 78 rows will wave through
 * "Chandana Fmtr" and only notice when a vendor bills for it.
 *
 *     "Secretary Of Housing & Urban Development"  ->  insured "Secretary Housing"
 *     "Jai Anand Kasturi & Chandana R Rao Fmtr"   ->  co-insured "Chandana Fmtr"
 *     "Aguero, M N & Valderrama, A Et Al"         ->  co-insured "Et Al Valderrama"
 *     "Maslinka, V & Maslinka, A & Maslinka,S"    ->  insured " Maslinka"
 *
 * These live here rather than in lib/ownerEntity because the stakes run the other way.
 * That file's own note explains why it errs narrow: a false positive there stops a real
 * homeowner being traced or mailed, silently. Here a false positive only moves a row from
 * "clear" to "look at this", which costs a glance. So this can afford to be suspicious
 * where the shared vocabulary cannot.
 */
const DEED_NOISE = /\b(ET\s*AL|ETAL|ET\s*UX|ET\s*VIR|FMTR|TRUSTEE|TRS|LIV|REV|IRREV|JT|JTWROS|TEN\s*COM|H\/W|LLE)\b/i;
const AGENCY = /\b(SECRETARY\s+OF|URBAN\s+DEVELOPMENT|HOUSING\s+AUTHORITY|VETERANS\s+AFFAIRS|FANNIE\s+MAE|FREDDIE\s+MAC|HUD)\b/i;

export interface NameRepair {
  leadId: string;
  propertyId: string | null;
  cohort: string | null;
  grade: string | null;
  raw: string;
  confidence: RepairConfidence;
  insured: { first: string; last: string } | null;
  /** Only when the string was not truncated — see the header. */
  coInsured: { first: string; last: string } | null;
  /** The tax roll's version, where we have one. The better authority when present. */
  rollName: string | null;
  reason: string;
}

/** The source field is 40 characters wide; anything at the limit lost its tail. */
const SOURCE_FIELD_WIDTH = 40;

export async function proposeNameRepairs(opts: {
  grades?: string[];
} = {}): Promise<NameRepair[]> {
  const grades = opts.grades ?? ['A', 'B', 'C'];
  const rows = await sql`
    SELECT "id", "propertyId", "cohort", "grade", "manualGrade",
           "owner1FirstName", "owner1LastName", "ownerVerifyName"
      FROM "Lead"
     WHERE ("owner1LastName" ~ '[,&]' OR "owner1FirstName" ~ '[,&]')
       AND COALESCE("manualGrade", "grade") = ANY(${grades}::text[])` as Array<Record<string, any>>;

  const out: NameRepair[] = [];
  for (const r of rows) {
    const raw = String(r.owner1LastName ?? '').trim();
    const base = {
      leadId: String(r.id),
      propertyId: r.propertyId ? String(r.propertyId) : null,
      cohort: r.cohort ? String(r.cohort) : null,
      grade: (r.manualGrade ?? r.grade) ?? null,
      raw,
      rollName: r.ownerVerifyName ? String(r.ownerVerifyName) : null,
    };

    if (ownerEntityOf(r) || AGENCY.test(raw)) {
      out.push({
        ...base, confidence: 'entity', insured: null, coInsured: null,
        reason: AGENCY.test(raw)
          // "Secretary Of Housing & Urban Development" splits on its ampersand into a
          // person called Secretary Housing. It is HUD.
          ? 'A government agency, not two people — the ampersand is part of its name.'
          : 'A trust or company, not two people. Left alone — tracing it would be the '
            + 'wrong thing to do, not a thing done badly.',
      });
      continue;
    }

    const truncated = raw.length >= SOURCE_FIELD_WIDTH;
    const parties = raw.split(/\s*(?:&| AND )\s*/i).map((s) => s.trim()).filter(Boolean);
    /**
     * Parsed as a one-party string, so parseRollOwners resolves the convention — comma
     * means LAST, FIRST and no comma means the last token is the surname — without also
     * trying to inherit a surname across the ampersand, which is a rule for tax-roll
     * strings and not for this column.
     */
    const first = parseRollOwners(parties[0] ?? '').person1;
    if (!first || !first.last) {
      out.push({
        ...base, confidence: 'entity', insured: null, coInsured: null,
        reason: 'Could not read a person out of the first owner. Needs an eye.',
      });
      continue;
    }

    const second = !truncated && parties[1]
      ? parseRollOwners(parties[1]).person1
      : null;

    /**
     * A parse that produced no first name at all is not a weak answer, it is a wrong one —
     * "Maslinka, V & Maslinka, A & Maslinka,S" yields a leading space and a surname, which
     * would write an empty first name over an empty first name and call it a repair.
     */
    const noFirstName = !first.first.replace(/[^A-Za-z]/g, '');
    const noisy = DEED_NOISE.test(raw);

    /**
     * A co-insured needs BOTH halves of a name, and neither may be deed shorthand.
     *
     * "Ha, Yong Jae & Rebecca & Lee, Haeng" offered a co-insured of " Rebecca" — no
     * surname, with the space still on the front — and "Mandalakis, C, S, & S" offered
     * " S". Those pass a presence check and fail a usefulness one: a half name on the card
     * is worse than no co-insured, because it reads as a person we have and silently
     * cannot reach. The insured on these rows is still perfectly good, so only the
     * co-insured half is dropped.
     */
    const bothHalves = (p: { first: string; last: string } | null) =>
      !!p && !!p.first.replace(/[^A-Za-z]/g, '') && !!p.last.replace(/[^A-Za-z]/g, '');
    const coInsured = bothHalves(second) && !DEED_NOISE.test(`${second!.first} ${second!.last}`)
      ? { first: second!.first, last: second!.last }
      : null;

    const initialOnly = first.first.replace(/[^A-Za-z]/g, '').length <= 1;
    const confidence: RepairConfidence = noFirstName || noisy
      ? 'suspect'
      : initialOnly
        ? 'initial_only'
        : truncated ? 'second_truncated' : 'clear';

    out.push({
      ...base,
      confidence,
      insured: noFirstName ? null : { first: first.first, last: first.last },
      coInsured,
      reason: confidence === 'clear'
        ? 'Two names in one field; the first is the insured.'
        : confidence === 'suspect'
          ? noFirstName
            ? 'No first name survives the parse, so there is nothing here to repair with.'
            : 'Carries deed shorthand (Et Al, Fmtr, Trustee and the like) that reads as a '
              + 'name once split. Not safe to apply from the string alone.'
          : confidence === 'initial_only'
            ? 'Readable, but the first name is a single initial — a vendor is unlikely to '
              + 'match on it, so this is worth a WIIP lookup before it is traced.'
            : `Cut at ${SOURCE_FIELD_WIDTH} characters by the source. The first owner is `
              + 'intact and usable; the second is half a name, so it is not proposed.',
    });
  }

  /** Clear ones first — the list is meant to be worked from the top. */
  const order: Record<RepairConfidence, number> = {
    clear: 0, second_truncated: 1, initial_only: 2, suspect: 3, entity: 4,
  };
  out.sort((a, b) => order[a.confidence] - order[b.confidence]);
  return out;
}
