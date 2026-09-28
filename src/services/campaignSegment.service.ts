import { sql } from '@/lib/neon';
import { insuredEmails, coInsuredEmails, assertRecipientCols } from './recipients.service';
import { bestInsuredAddress, bestCoInsuredAddress } from './addressRank.service';
import { heldAddresses } from './emailNameReview.service';

/**
 * Which campaign an account belongs to, and which version of it each person receives.
 *
 * Frank's directive, 24 Sep 2026.
 *
 * ── Segment ─────────────────────────────────────────────────────────────────
 * §1.10: "Grade A rated, Grade A unrated, and Grade B are tracked as three separate
 * campaigns. No metric is ever reported across them. A blended number is worse than no
 * number, because it looks authoritative and means nothing."
 *
 * §1.4: "The track is decided at the moment each email is built, by whether a
 * producer-entered premium exists. If it doesn't, that account gets the unrated content and
 * that is the end of it."
 *
 * So segment is decided from a producer-entered premium and nothing else. Not from the
 * status column, which the skip-trace blast rewrites — that is what had a week holding 61
 * rated accounts reporting 48. Not from enrichment data either: enrichment fills
 * eligibility and flood fields, and an account marked rated by a machine would receive a
 * band price that does not exist.
 *
 * ── Test arms ───────────────────────────────────────────────────────────────
 * §3: "Per person, at random, balanced within each cohort, pooled across cohorts when read.
 * Built in the CRM at list build and written to the lead record — not in the email tool,
 * whose randomiser will not balance across cohorts."
 *
 * Balanced means balanced, not "random and probably close". The list is shuffled and then
 * dealt alternately, which makes the two arms differ by at most one in every cohort. A coin
 * flip per person gives a 60/40 split often enough to matter on a cohort of sixty.
 */

export type Segment = 'rated' | 'unrated' | 'grade_b';

/** §6.2, in the words Frank rewrote them into. Nobody should have to decode a row. */
export const SEGMENT_LABEL: Record<Segment, string> = {
  rated: 'Rated',
  unrated: 'Not rated',
  grade_b: 'Grade B',
};

export const COHORT_LABEL: Record<string, string> = {
  '2026-10-05': 'C1',
  '2026-10-12': 'C2',
  '2026-10-19': 'C3',
  '2026-10-26': 'C4',
  '2026-11-02': 'C5',
  '2026-11-09': 'C6',
  '2026-11-16': 'C7',
};

/** Grade B is not a renewal week — §6.2 labels it Wave 2. */
export const GRADE_B_COHORT_LABEL = 'Wave 2';

/**
 * The short name of the subject line a version carries.
 *
 * ── This is NOT a property of the A/B variant ───────────────────────────────
 * It was written as a flat map — A meant "Renewal month", B meant "Street name", everywhere.
 * That is wrong, and Frank's own examples say so: an unrated C4 email 2 on variant A is
 * "Three things", and a rated C6 email 2 on variant B is "Renewal month". The same letter
 * names a different subject line depending on the segment, the cohort group and the step,
 * because those are what decide which of the nineteen subject lines in §5 actually goes out.
 *
 * Getting this wrong is not cosmetic. §6 opens: "a reply recorded without knowing which
 * version produced it can never be traced back to one. That information does not exist
 * later." A label naming the wrong subject line is worse than no label — it attributes a
 * result to copy the reader never saw, and nothing downstream can detect it.
 *
 * Transcribed from the subject-line table in §6.2 as rewritten on 24 Sep 2026.
 */
export function subjectFor(input: {
  segment: Segment;
  /** The cohort DATE, as stored on the lead. */
  cohort: string;
  step: number;
  variant: 'A' | 'B';
}): { name: string; template: string } {
  /**
   * Name and text together, from one branch each.
   *
   * They were going to be two functions with the same seventeen-way branching, which is two
   * copies of a rule that has to agree forever. It would not agree: the short name is not
   * unique — "Renewal month" covers three different subject lines and "Following up" covers
   * two — so a text lookup keyed on the name would return the wrong line for C6–C7 and for
   * every unrated C4–C7 account, silently.
   */
  const pick = (
    a: [string, string], b: [string, string],
  ) => {
    const [name, template] = input.variant === 'A' ? a : b;
    return { name, template };
  };

  // §5.11 — one pair, wave two.
  if (input.segment === 'grade_b') {
    return pick(
      ['Roof question', 'a question about the roof on {{ street_name }}'],
      ['Odd question', 'odd question — your roof'],
    );
  }

  /** C1…C7 as a number, so the groupings below read the way §5 is written. */
  const c = Number((COHORT_LABEL[input.cohort] ?? '').replace('C', '')) || 0;
  const rated = input.segment === 'rated';

  if (input.step === 1) {
    /**
     * §1.2: C1–C5 lead with the number, C6 and C7 introduce first. So a RATED C6/C7 account
     * gets the introduction (§5.4) at email 1, not the priced email — and every unrated
     * account from C4 on gets it too.
     */
    const introduction = (rated && c >= 6) || (!rated && c >= 4);
    if (introduction) {
      return pick(
        ['Early note', 'early note about your {{ month }} renewal'],
        ['Local agent', 'a local agent in {{ town }}, writing early'],
      );
    }
    if (rated) {
      return pick(
        ['Renewal month', 'your {{ month }} renewal — what I\'d expect it to run'],
        // §5.1 for C1–C3, §5.3 for C4–C5 — same short name, different line.
        c <= 3
          ? ['Street name', '{{ street_name }} — a number before you renew']
          : ['Street name', '{{ street_name }} — a number, six weeks early'],
      );
    }
    return pick(                                                  // §5.2 C1–C3 unrated
      ['Renewal month', 'your {{ month }} renewal'],
      ['Since you closed', 'nobody\'s looked at this since you closed'],
    );
  }

  if (input.step === 2) {
    if (c <= 3) {                                                 // §5.5 / §5.6 — both tracks
      return pick(
        ['Last stretch', '{{ renewal_date }} — the last stretch'],
        ['Following up', 'following up before {{ renewal_date }}'],
      );
    }
    if (rated && c <= 5) {                                        // §5.7 C4–C5
      return pick(
        ['Your number', 'following up on your {{ town }} number'],
        ['Range to real', 'what turns that range into a real number'],
      );
    }
    if (rated) {                                                  // §5.8 C6–C7
      return pick(
        ['As promised', 'as promised — a number for {{ street_name }}'],
        ['Renewal month', 'what I\'d expect your {{ month }} renewal to run'],
      );
    }
    return pick(                                                  // §5.9 C4–C7 unrated
      ['Three things', 'three things that move a renewal premium'],
      ['Following up', 'following up before your {{ month }} renewal'],
    );
  }

  // §5.10 — email 3 runs C4–C7 only, and is the same copy on both tracks.
  return pick(
    ['Last note', 'last note before {{ month }}'],
    ['Closing the loop', 'closing the loop on your {{ month }} renewal'],
  );
}

/** The short name §6.2 puts in a report. */
export function subjectName(input: {
  segment: Segment; cohort: string; step: number; variant: 'A' | 'B';
}): string {
  return subjectFor(input).name;
}

/**
 * Which email steps a cohort actually receives (§2 send calendar).
 *
 * C1 gets two emails, C2 and C3 two, C4–C7 three. Emitting a third subject line for C1 would
 * put copy in the platform for a send that is not in the calendar, and the first person to
 * notice it there would reasonably assume it was meant to go out.
 */
export function stepsFor(cohort: string): number[] {
  const c = Number((COHORT_LABEL[cohort] ?? '').replace('C', '')) || 0;
  return c >= 4 ? [1, 2, 3] : [1, 2];
}

/**
 * The call to action, by email step and arm. Wording is Frank's, verbatim — the copy and
 * the label must not drift apart, or a result describes an ask nobody made.
 */
export const CTA_BY_STEP: Record<number, Record<1 | 2, { name: string; wording: string }>> = {
  1: {
    1: { name: 'Reply yes', wording: 'Reply "yes" and I\'ll get started.' },
    2: {
      name: 'Share your premium',
      wording: 'Reply with what you\'re paying now and I\'ll tell you tomorrow whether it\'s competitive.',
    },
  },
  2: {
    1: { name: 'Answer tomorrow', wording: 'Reply and I\'ll have your number back to you tomorrow.' },
    2: { name: 'Book 15 minutes', wording: 'Grab 15 minutes here: {{ agency_website }}/meet' },
  },
  3: {
    1: { name: 'Pick a time', wording: 'Pick a time and I\'ll call you: {{ agency_website }}/meet' },
    2: {
      name: 'Book or reply',
      wording: '{{ agency_website }}/meet — or reply with a time and I\'ll call you.',
    },
  },
};

/**
 * Grade B has ONE arm, not two (§3: "R4 · Single arm, wave two").
 *
 * Held separately rather than as a third entry in CTA_BY_STEP, because that table is keyed
 * by step and Grade B's single arm applies whatever the step. Folding it in would mean
 * either duplicating it across three steps or pretending Grade B has an arm 2 — and an arm
 * that does not exist would eventually get dealt to somebody.
 */
export const GRADE_B_CTA = {
  name: 'Reply with the year',
  wording: 'Reply with the year and I\'ll take it from there.',
} as const;

/**
 * The readable name for one version, as §6.2 now specifies:
 *
 *   Rated · C1 · Email 1 · Renewal month · Reply yes
 *
 * The five parts are also stored separately, because a joined string cannot be grouped by.
 * This is the display form, not the source of truth.
 */
export function versionLabel(input: {
  segment: Segment;
  cohort: string;
  step: number;
  subjectVariant: 'A' | 'B';
  ctaArm: 1 | 2;
}): string {
  const cohort = input.segment === 'grade_b'
    ? GRADE_B_COHORT_LABEL
    : (COHORT_LABEL[input.cohort] ?? input.cohort);
  const subject = subjectName({
    segment: input.segment,
    cohort: input.cohort,
    step: input.step,
    variant: input.subjectVariant,
  });
  // Grade B's single arm applies at every step; the two-arm table is Grade A only.
  const cta = input.segment === 'grade_b'
    ? GRADE_B_CTA.name
    : (CTA_BY_STEP[input.step]?.[input.ctaArm]?.name ?? '?');
  return `${SEGMENT_LABEL[input.segment]} · ${cohort} · Email ${input.step} · ${subject} · ${cta}`;
}

/**
 * Is this account rated? A producer-entered premium exists, or it does not.
 *
 * Takes the lead rather than reading the database, so the same rule can be applied to a row
 * already in hand — and so it is testable without a connection.
 */
export function segmentOf(lead: {
  travelersPremium?: unknown;
  plymouthPremium?: unknown;
  ratedSource?: unknown;
  grade?: unknown;
  manualGrade?: unknown;
}): Segment {
  const grade = String(lead.manualGrade || lead.grade || '');
  if (grade === 'B') return 'grade_b';

  /**
   * A premium with a SYSTEM source is not a rating.
   *
   * Frank, 24 Sep 2026: "only the producer-entered value decides which email an account
   * receives." An account marked rated by a machine would be sent a band price that does
   * not exist, which is worse than sending it the unrated copy.
   *
   * A NULL source is left as it was: it means nobody has recorded where the premium came
   * from, not that a machine wrote it. Of 778 accounts carrying a premium, 653 are proven
   * producer-entered by their own activity history, 56 had the card edited by a person
   * without the premium change being logged, and 69 carry no evidence at all. Reading those
   * 125 as unrated would strip a band price from accounts that probably have a real one;
   * reading them as system-populated would assert something nothing supports. So they keep
   * the old behaviour and are surfaced for review instead.
   */
  if (lead.ratedSource === 'system') return 'unrated';

  const rated = lead.travelersPremium != null || lead.plymouthPremium != null;
  return rated ? 'rated' : 'unrated';
}

/**
 * Deal a two-armed assignment across a list so the arms differ by at most one.
 *
 * Shuffled first so the order the database returned rows in carries no signal — leads come
 * back grouped by cohort and city, and dealing straight down that order would put one arm
 * disproportionately in one town.
 */
function dealEvenly<T>(items: T[], arms: [string, string]): Map<T, string> {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out = new Map<T, string>();
  shuffled.forEach((item, i) => out.set(item, arms[i % 2]));
  return out;
}

export type SendListResult = {
  cohorts: number;
  leads: number;
  bySegment: Record<Segment, number>;
  /** People, not leads — the insured and co-insured are assigned separately. */
  peopleAssigned: number;
  /** Already carried an assignment and were left alone. */
  alreadyAssigned: number;
  balance: Array<{ cohort: string; subjectA: number; subjectB: number; arm1: number; arm2: number }>;
  /**
   * Grade A leads inside the range that were NOT assigned, because their cohort's list was
   * already built and they were not in it (fix 19).
   *
   * Reported rather than silently skipped: "the list did not grow" and "eleven accounts
   * were held back" look identical in a count of assignments, and only one of them needs
   * somebody to decide something.
   */
  heldFromFrozen: number;
  heldByCohort: Array<{ cohort: string; n: number }>;
  /**
   * Grade A leads in the window that CANNOT be sent to — no address at all, or already
   * suppressed. They are not on the list and are not counted in `leads`.
   *
   * Reported rather than dropped quietly: a send total that is smaller than the cohort is
   * fine, and a send total that is smaller than the cohort for reasons nobody wrote down is
   * how a week of 850 turns into 716 with no explanation available.
   */
  notSendable: number;
  notSendableByCohort: Array<{ cohort: string; n: number }>;
};

/**
 * Assign segment and test arms across a range of renewal weeks, and freeze the list.
 *
 * ── Never reassigns ─────────────────────────────────────────────────────────
 * The segment is frozen the same way. §1.4: "The track is decided at the moment each email
 * is built... If it doesn't, that account gets the unrated content and that is the end of
 * it." Recomputing it would switch an account from unrated to rated content between email 1
 * and email 2 if anybody rated it in between, which is the one thing that section forbids.
 *
 * An account that already carries an arm keeps it. Re-running this must not move somebody
 * from arm 1 to arm 2 halfway through a sequence: the follow-ups are seven days behind each
 * account's own send, so a reassignment between steps would send one person both arms and
 * corrupt the only two comparisons wave one exists to produce.
 */
export async function buildSendList(params: {
  effFrom: string;
  effTo: string;
  dryRun?: boolean;
}): Promise<SendListResult> {
  const { effFrom, effTo, dryRun = true } = params;

  /**
   * The recipient columns are read because a person only enters the balance if there is
   * somewhere to send to them. A name without an address is not a reader.
   */
  const leads = await sql`
    SELECT "id", "cohort", "grade", "manualGrade", "travelersPremium", "plymouthPremium", "ratedSource",
           "sendListBuiltAt",
           -- The push refuses on these three. Read here so the list cannot promise somebody
           -- the send will then decline.
           "hardBounced", "campaignUnsubscribedAt", "campaignStatus",
           "campaignSegment", "insuredSubjectVariant", "insuredCtaArm",
           "coInsuredSubjectVariant", "coInsuredCtaArm",
           "email1", "email2", "owner2Email", "emailsAll", "skipTraceData",
           "phone1", "phone2", "owner2Phone", "phonesAll",
           "owner1FirstName", "owner1LastName", "owner2FirstName", "owner2LastName"
      FROM "Lead"
     WHERE "cohort" BETWEEN ${effFrom} AND ${effTo}
       AND COALESCE("manualGrade", "grade") = 'A'
     ORDER BY "cohort", "id"` as Array<Record<string, unknown>>;
  assertRecipientCols(leads[0], 'send list build');

  /**
   * Addresses held by the surname review, loaded once (Frank, second email §7).
   *
   * A person whose one mailable address is held is not reachable, so they must not enter
   * the deal — see the slot loop below for what dealing them anyway did to the balance.
   */
  const heldEmails = await heldAddresses();

  const byCohort = new Map<string, Array<Record<string, unknown>>>();
  for (const l of leads) {
    const c = String(l.cohort);
    if (!byCohort.has(c)) byCohort.set(c, []);
    byCohort.get(c)!.push(l);
  }

  /**
   * ── The freeze (Frank, fix 19) ───────────────────────────────────────────
   *
   * "Cohort populations freeze when the send list is built; later recaptures go to a
   * holding pool."
   *
   * A cohort is frozen once any lead in it carries sendListBuiltAt. Without this guard a
   * second run of the builder sweeps every account that arrived since — recaptured,
   * re-graded, newly traced — straight into a population that has already been counted,
   * reported to Frank, and in some cases already mailed. Nothing errors; the cohort is
   * simply bigger than the number everyone agreed on, and no record survives of when it
   * changed or by how much.
   *
   * Derived from the stamp rather than a list of frozen weeks kept somewhere, because a
   * hand-kept list is wrong the first time somebody builds a list and forgets to update it.
   */
  const frozen = new Set<string>();
  for (const [c, group] of byCohort) {
    if (group.some((l) => l.sendListBuiltAt != null)) frozen.add(c);
  }

  const out: SendListResult = {
    cohorts: byCohort.size,
    leads: leads.length,
    bySegment: { rated: 0, unrated: 0, grade_b: 0 },
    peopleAssigned: 0,
    alreadyAssigned: 0,
    balance: [],
    heldFromFrozen: 0,
    heldByCohort: [],
    notSendable: 0,
    notSendableByCohort: [],
  };

  for (const [cohort, group] of byCohort) {
    /**
     * One entry per PERSON, which is the unit §3 balances on. A lead with a co-insured
     * contributes two; a lead without contributes one.
     */
    /**
     * A slot per person WITH AN ADDRESS, not per person with a name.
     *
     * The first version balanced over everyone carrying a name, which put 290 people who
     * can never be mailed into the deal. Their arms are dead weight, and the balance among
     * people who actually receive something drifted to 57/43 on one cohort — which is the
     * split Frank's "balanced, not random" instruction exists to prevent. Balancing the
     * unmailable reproduces the fault it was meant to fix.
     */
    /**
     * Late arrivals leave the build here — before the balance, not after.
     *
     * They must not enter the deal at all: dealing them an arm and then declining to write
     * it would shift every other person's arm by one and quietly unbalance a cohort that
     * has already sent.
     */
    const isFrozen = frozen.has(cohort);
    const late = isFrozen ? group.filter((l) => l.sendListBuiltAt == null) : [];
    if (late.length) {
      out.heldFromFrozen += late.length;
      out.heldByCohort.push({ cohort, n: late.length });
    }
    const inFreeze = isFrozen ? group.filter((l) => l.sendListBuiltAt != null) : group;

    /**
     * ── The list is who we can actually send to ──────────────────────────────
     *
     * This used to stamp every Grade A lead in the window, including 53 with no email
     * address of any kind and one already suppressed. They were counted in the total Frank
     * was given, and the push would have refused all of them — so the list said 850 and the
     * send would have been 716, with nothing in between explaining the difference.
     *
     * Excluded BEFORE the deal, not filtered out of it afterwards. An account that entered
     * the deal and was then dropped would shift every other person's arm by one, which is
     * how a cohort ends up perfectly balanced on paper and materially skewed in what sends.
     *
     * The holdout is deliberately NOT a reason to exclude. §1.9: "No holdout group in wave
     * one." The flag stays on the record for wave two; it just does not keep anybody off
     * this list.
     */
    const sendable = (l: Record<string, unknown>) => {
      // Reachable at ONE of the two people, after the surname hold. A lead whose only
      // address is held has nobody to write to and does not belong on the list.
      const ins = String(bestInsuredAddress(l)?.email ?? "").trim().toLowerCase();
      const co = String(bestCoInsuredAddress(l)?.email ?? "").trim().toLowerCase();
      const reach = (ins && !heldEmails.has(ins)) || (co && !heldEmails.has(co));
      if (!reach) return false;
      if (l.hardBounced === true) return false;
      if (l.campaignUnsubscribedAt != null) return false;
      if (String(l.campaignStatus ?? '') === 'suppressed') return false;
      return true;
    };
    const unsendable = inFreeze.filter((l) => !sendable(l));
    if (unsendable.length) {
      out.notSendable += unsendable.length;
      out.notSendableByCohort.push({ cohort, n: unsendable.length });
    }
    const group2 = inFreeze.filter(sendable);

    /**
     * ── A slot is a person the push would actually reach ─────────────────────
     *
     * Tested against the ONE address the push picks, not against "has any address", and
     * against the surname hold as well.
     *
     * The first version counted anyone with a candidate address. The surname review then
     * held 265 of those people AFTER the arms were dealt, which left holes in the deal: the
     * C4–C7 export came out balanced to within one person as dealt and off by SEVENTEEN in
     * what would actually send. That is the same failure the holdout produced before the
     * re-cut, one layer further down — arms balanced over people who never receive anything
     * answer nothing, and the report still calls itself balanced.
     *
     * An address approved out of review later is a late arrival to a frozen cohort, which
     * is exactly what the holding pool exists for. It is visible there rather than silently
     * joining a week that has already been counted.
     */
    type Slot = { id: string; role: 'insured' | 'coInsured' };
    const slots: Slot[] = [];
    const reachable = (best: { email?: string } | null) => {
      const e = String(best?.email ?? '').trim().toLowerCase();
      return !!e && !heldEmails.has(e);
    };
    for (const l of group2) {
      if (reachable(bestInsuredAddress(l))) {
        if (l.insuredCtaArm == null) slots.push({ id: String(l.id), role: 'insured' });
        else out.alreadyAssigned++;
      }
      if (reachable(bestCoInsuredAddress(l))) {
        if (l.coInsuredCtaArm == null) slots.push({ id: String(l.id), role: 'coInsured' });
        else out.alreadyAssigned++;
      }
    }

    const subject = dealEvenly(slots, ['A', 'B']);
    const arm = dealEvenly(slots, ['1', '2']);

    let subjectA = 0; let subjectB = 0; let arm1 = 0; let arm2 = 0;
    for (const s of slots) {
      if (subject.get(s) === 'A') subjectA++; else subjectB++;
      if (arm.get(s) === '1') arm1++; else arm2++;
    }
    out.balance.push({ cohort, subjectA, subjectB, arm1, arm2 });
    out.peopleAssigned += slots.length;

    if (dryRun) {
      for (const l of group2) out.bySegment[segmentOf(l)]++;
      continue;
    }

    for (const l of group2) {
      const seg = segmentOf(l);
      out.bySegment[seg]++;
      const ins = slots.find((s) => s.id === String(l.id) && s.role === 'insured');
      const co = slots.find((s) => s.id === String(l.id) && s.role === 'coInsured');
      /**
       * ── The segment is DERIVED; the deal is not. They are written differently ──
       *
       * campaignSegment answers "has a producer rated this account", and that answer
       * changes: a producer enters a premium on Tuesday for a card segmented on Monday.
       * COALESCE wrote it once and never looked again, so the Monday answer stood forever.
       *
       * 9 C4-C7 accounts were stored 'unrated' at 12:31 on 25 Sep and rated by a producer
       * at 15:39, 15:46, 16:50 and 18:16 the same afternoon. A further 74 were never
       * segmented at all. Together that is 83 accounts holding a band price nobody would
       * ever send them, and it is most of the 401-vs-276 gap Frank asked about.
       *
       * So the segment is recomputed from segmentOf() on every build.
       *
       * The subject variant and CTA arm keep their COALESCE, and that is deliberate rather
       * than an oversight. They are a BALANCED DEAL, not a derived fact: re-dealing an arm
       * someone has already been assigned changes what a live contact receives, silently
       * unbalances a cohort that has already been counted, and leaves the platform holding
       * a version_label that no longer describes the email. Once dealt, they are history.
       *
       * ── Both freeze the moment anything has actually SENT ──────────────────
       *
       * After a send, the segment decides what the NEXT step says. Flipping an account from
       * unrated to rated between email 1 and email 2 would send a band price to somebody who
       * was told last week we had not priced them — and no report afterwards could say which
       * copy any given person received. Fix 19 forbids exactly that.
       *
       * The guard is on sentAt, not on the existence of an OutreachEvent row. A registered
       * row means a contact was prepared; only sentAt means a homeowner was written to.
       */
      await sql`
        UPDATE "Lead" l
           SET "campaignSegment"   = CASE WHEN mailed.yes THEN l."campaignSegment" ELSE ${seg} END,
               "campaignSegmentAt" = CASE WHEN mailed.yes THEN l."campaignSegmentAt" ELSE NOW() END,
               "insuredSubjectVariant"   = COALESCE(l."insuredSubjectVariant", ${ins ? subject.get(ins)! : null}),
               "insuredCtaArm"           = COALESCE(l."insuredCtaArm", ${ins ? Number(arm.get(ins)) : null}),
               "coInsuredSubjectVariant" = COALESCE(l."coInsuredSubjectVariant", ${co ? subject.get(co)! : null}),
               "coInsuredCtaArm"         = COALESCE(l."coInsuredCtaArm", ${co ? Number(arm.get(co)) : null}),
               "sendListBuiltAt"   = COALESCE(l."sendListBuiltAt", NOW()),
               "updatedAt"         = NOW()
          FROM (
            SELECT EXISTS (
              SELECT 1 FROM "OutreachEvent" oe
               WHERE oe."leadId" = ${String(l.id)} AND oe."sentAt" IS NOT NULL
            ) AS yes
          ) AS mailed
         WHERE l."id" = ${String(l.id)}`;
    }
  }

  /**
   * Held accounts are not on the list, so they are not part of its population. Leaving them
   * in this count would make the three segments fail to add up to it, and the first person
   * to notice would reasonably conclude the segment split was broken.
   */
  out.leads -= out.heldFromFrozen + out.notSendable;
  return out;
}
