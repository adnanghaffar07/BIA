import { sql } from '@/lib/neon';
import { cohortLabel, cohortEnd, cohortOf } from './cohort';
import { LOST_TARGET_PCT } from '@/lib/targets';
import { insuredEmails, assertRecipientCols } from './recipients.service';

/**
 * The cohort ledger (register A43).
 *
 * ── The question this answers ────────────────────────────────────────────────
 * Frank, 17 Sep 2026: "What do we start with grade A poll? What do we end up with due to
 * downgrading because of no contact info? And then what do we get back to by implementing
 * this? And then what's the total percent? Grade A started, grade A previous, we lost 40%.
 * Grade A current, we only lost 5%. That's the target, 5%."
 *
 * Four numbers per renewal week, not one. Reading "the cohort has N Grade A" as though it
 * were "the pull had N Grade A" is what turned a measurable pipeline into a 90-minute
 * argument: both figures are correct and they are not the same measurement, and until the
 * drop between them is shown as its own column nobody can say whether the skip trace is
 * recovering leads or whether they are simply being lost.
 *
 * ── Where the numbers come from ──────────────────────────────────────────────
 *   at pull    "Lead"."gradeAtPull"  — the grade the lead carried when its cohort was
 *                                     pulled (register A8, recovered from the activity
 *                                     feed while that feed was still complete)
 *   left A     a "GradeChange" row with fromGrade = 'A'
 *   regained A left A, and is Grade A again today
 *   email found the contact-recovery pipeline found the insured an email
 *   now        COALESCE(manualGrade, grade), i.e. what the CRM shows
 *
 * Nothing here is stored or cached. Every figure is derived on read from the grade log, so
 * it cannot fall out of step with the cards the way a snapshot would.
 */

export type CohortLedgerRow = {
  /** Monday of the renewal week, e.g. '2026-10-05'. */
  cohort: string;
  /** "Oct 5 – 11, 2026" */
  label: string;
  /** Inclusive Sunday, for anyone reconciling against a from/to range. */
  endsOn: string | null;
  total: number;
  /** Grade A when the cohort was pulled. */
  aAtPull: number;
  /** Of those, how many have left Grade A at any point, per the grade log. */
  downgraded: number;
  /**
   * The low-water mark: Grade A at pull, still Grade A, and never left.
   *
   * Derived as stillA - recovered, NOT as aAtPull - downgraded. Those two disagree
   * whenever a lead left Grade A without leaving a GradeChange row, and the log is a
   * backfill so a handful do. The first form can exceed the current count — it reported
   * a trough of 274 against 269 Grade A today — and a ledger whose columns do not add up
   * will be the only thing anyone remembers about it. See `unexplained`.
   */
  trough: number;
  /**
   * Left Grade A and is Grade A again today — a GRADE round trip.
   *
   * This is not what the skip trace buys, and reading it as though it were understates
   * the recovery work by an order of magnitude: in the Oct 5 week it is 1, while 11 leads
   * in that same week had an insured email found for them. Those 11 never left Grade A —
   * they were Grade A and unmailable, which is what isolation is — so finding them an
   * address changed their reach and not their grade. `emailRecovered` is that number.
   */
  recovered: number;
  /**
   * Leads the contact-recovery pipeline found an insured email for.
   *
   * The measurement that answers "what did the skip trace buy?", because it is the one
   * that moves `mailable`. Counted from the lead's own recovery stage, so it cannot
   * disagree with the pipeline tabs in QC → Blast Skip Traces.
   */
  emailRecovered: number;
  /** Grade A at pull and Grade A today. */
  stillA: number;
  /** Grade A today but NOT at pull — climbed up from below. */
  gainedOther: number;
  /** Grade A today, from any origin. What the Renewal Week chip shows. */
  aNow: number;
  /**
   * Of those, how many have an insured email — the ones the campaign can actually mail.
   *
   * aNow measures eligibility, this measures reach. They are far apart, and quoting the
   * first as though it were the second is how a cohort under-delivers against its own
   * forecast.
   */
  mailable: number;
  /** aAtPull - stillA. */
  lost: number;
  /** lost / aAtPull, as a percentage. Frank's target is <= 5. */
  lostPct: number | null;
  /**
   * Leads in this cohort with no recorded starting grade.
   *
   * Carried on every row rather than footnoted: these leads are outside the measurement
   * entirely, and a loss percentage quoted without saying how many leads it could not see
   * is the kind of number that gets argued about later.
   */
  noPullRecord: number;
  /** Leads in this cohort a producer has rated. Zero means the week has not been worked. */
  rated: number;
  /**
   * Grade A leads still sitting at status 'new' in a cohort that HAS been worked.
   *
   * ── Why this is its own column (register A42) ───────────────────────────
   * Frank, 17 Sep 2026: "There's not a chance in hell you missed these… I know Ruben. I
   * know my guy." He was right — they were not missed. The 10/26 week holds 153 unworked
   * Grade A leads in Middlesex against 12 rated there, while Monmouth in the same week is
   * 46 rated against 5 unworked. The leads existed the whole time and were never put in
   * front of anyone.
   *
   * It matters beyond tidiness: a rated lead gets an indicative price in the second email
   * and an unrated one cannot, so a cohort silently holding unworked Grade A leads breaks
   * the cadence rather than just the count.
   */
  unworkedGradeA: number;
  /** Where those unworked leads sit, when they cluster in one place — the blind spot. */
  unworkedTopCounty: string | null;
  unworkedTopCountyShare: number | null;
  /**
   * Leads that are no longer Grade A and have no logged reason for it.
   *
   * lost - (downgraded - recovered). A non-zero value means the grade log is missing
   * changes for that many leads, so the split between "downgraded for missing contact
   * info" and "downgraded for something else" understates by this much. Shown rather
   * than quietly absorbed: the whole point of the ledger is that a number nobody can
   * account for is what started the argument.
   */
  unexplained: number;
};

export { LOST_TARGET_PCT };

/** Below this many unworked leads, a county share is noise rather than a blind spot. */
const MIN_CLUSTER = 10;

export async function getCohortLedger(
  params: { effFrom?: string; effTo?: string } = {},
): Promise<CohortLedgerRow[]> {
  const { effFrom, effTo } = params;

  /**
   * The range selects WHOLE renewal weeks, not a slice of days.
   *
   * Filtering leads by effectiveDate and then labelling each group "Oct 26 – Nov 1, 2026"
   * reports a partial week under a full-week heading: ask for 10/28–11/02 and the Oct 26
   * row silently drops the Mon/Tue leads while still claiming to be the whole week, so
   * "Grade A at pull" reads low and nothing on screen says why. Every column here is a
   * per-week measurement, so the unit of selection has to be the week too.
   *
   * Any week the range touches is included in full. cohortOf() gives the Monday of the
   * week containing a date, and cohorts sort correctly as ISO strings.
   */
  const fromCohort = effFrom ? cohortOf(effFrom) : null;
  const toCohort = effTo ? cohortOf(effTo) : null;

  const rows = await sql`
    WITH scoped AS (
      SELECT l."id",
             l."cohort",
             l."gradeAtPull",
             l."status",
             l."recoveryStage",
             COALESCE(l."manualGrade", l."grade") AS now_grade
        FROM "Lead" l
       WHERE l."cohort" IS NOT NULL
         AND (${fromCohort}::text IS NULL OR l."cohort" >= ${fromCohort})
         AND (${toCohort}::text   IS NULL OR l."cohort" <= ${toCohort})
    ),
    flagged AS (
      SELECT s.*,
             EXISTS (SELECT 1 FROM "GradeChange" g
                      WHERE g."leadId" = s."id" AND g."fromGrade" = 'A') AS left_a
        FROM scoped s
    )
    SELECT "cohort",
           COUNT(*)::int                                                              AS total,
           COUNT(*) FILTER (WHERE "gradeAtPull" = 'A')::int                           AS a_at_pull,
           COUNT(*) FILTER (WHERE "gradeAtPull" = 'A' AND left_a)::int                AS downgraded,
           COUNT(*) FILTER (WHERE "gradeAtPull" = 'A' AND left_a
                              AND now_grade = 'A')::int                               AS recovered,
           COUNT(*) FILTER (WHERE "recoveryStage" = 'recovered')::int                 AS email_recovered,
           COUNT(*) FILTER (WHERE "gradeAtPull" = 'A' AND now_grade = 'A')::int        AS still_a,
           COUNT(*) FILTER (WHERE "gradeAtPull" IS DISTINCT FROM 'A'
                              AND now_grade = 'A')::int                               AS gained_other,
           COUNT(*) FILTER (WHERE now_grade = 'A')::int                               AS a_now,
           COUNT(*) FILTER (WHERE "gradeAtPull" IS NULL)::int                         AS no_pull_record,
           COUNT(*) FILTER (WHERE status = 'rated')::int                              AS rated,
           COUNT(*) FILTER (WHERE status = 'new' AND now_grade = 'A')::int            AS unworked_a
      FROM flagged
     GROUP BY "cohort"
     ORDER BY "cohort"`;

  /**
   * Where the unworked Grade A leads sit.
   *
   * Reported only when they CLUSTER: leads spread evenly across counties are simply work
   * still to do, while a week whose untouched leads are almost all in one county is a
   * blind spot — that is the shape the 10/26 Middlesex leads made, and the shape nobody
   * could see until it was counted this way.
   */
  /**
   * How many of the Grade A leads can actually be emailed.
   *
   * The grade columns measure eligibility; this measures reach, and the two diverge badly
   * — the Oct 12 week holds 87 Grade A of which 46 are mailable. A ledger that reports
   * only the grade reads as though the whole 87 are workable, and a week can look like its
   * best on the loss column while barely half of it can be contacted.
   *
   * Computed with the SAME rule the Renewal Week chips and the campaign push use, so the
   * ledger cannot promise reach the push would not act on. That means reading the
   * recipient columns rather than a SQL predicate: the insured's addresses are attributed
   * per person inside the trace payload, and `email1 IS NOT NULL` both misses addresses
   * and counts the co-insured's as the insured's.
   */
  const reachRows = await sql`
    SELECT "cohort", "email1", "email2", "owner2Email",
           "phone1", "phone2", "owner2Phone",
           "owner1FirstName", "owner1LastName", "owner2FirstName", "owner2LastName",
           "skipTraceData", "emailsAll",
           COALESCE("manualGrade", "grade") AS now_grade
      FROM "Lead"
     WHERE "cohort" IS NOT NULL
       AND (${fromCohort}::text IS NULL OR "cohort" >= ${fromCohort})
       AND (${toCohort}::text   IS NULL OR "cohort" <= ${toCohort})`;
  assertRecipientCols((reachRows as any[])[0], 'cohort ledger (mailable)');

  const mailableByCohort = new Map<string, number>();
  for (const r of reachRows as any[]) {
    if (r.now_grade !== 'A') continue;
    if (insuredEmails(r).length === 0) continue;
    mailableByCohort.set(r.cohort, (mailableByCohort.get(r.cohort) ?? 0) + 1);
  }

  const clusters = await sql`
    SELECT "cohort", "addressCounty" AS county, COUNT(*)::int n
      FROM "Lead"
     WHERE "cohort" IS NOT NULL
       AND "status" = 'new'
       AND COALESCE("manualGrade", "grade") = 'A'
       AND (${fromCohort}::text IS NULL OR "cohort" >= ${fromCohort})
       AND (${toCohort}::text   IS NULL OR "cohort" <= ${toCohort})
     GROUP BY 1, 2`;

  const topByCohort = new Map<string, { county: string | null; n: number; total: number }>();
  for (const c of clusters as any[]) {
    const seen = topByCohort.get(c.cohort) ?? { county: null, n: 0, total: 0 };
    seen.total += Number(c.n);
    if (Number(c.n) > seen.n) { seen.n = Number(c.n); seen.county = c.county ?? null; }
    topByCohort.set(c.cohort, seen);
  }

  return (rows as any[]).map((r) => {
    const aAtPull = Number(r.a_at_pull);
    const stillA = Number(r.still_a);
    const downgraded = Number(r.downgraded);
    const recovered = Number(r.recovered);
    const lost = aAtPull - stillA;
    return {
      cohort: r.cohort,
      label: cohortLabel(r.cohort),
      endsOn: cohortEnd(r.cohort),
      total: Number(r.total),
      aAtPull,
      downgraded,
      trough: stillA - recovered,
      recovered,
      emailRecovered: Number(r.email_recovered),
      unexplained: lost - (downgraded - recovered),
      stillA,
      gainedOther: Number(r.gained_other),
      aNow: Number(r.a_now),
      mailable: mailableByCohort.get(r.cohort) ?? 0,
      lost,
      // A cohort with no Grade A at pull has no loss rate — not a loss rate of zero.
      lostPct: aAtPull ? Math.round((lost / aAtPull) * 1000) / 10 : null,
      noPullRecord: Number(r.no_pull_record),
      rated: Number(r.rated),
      unworkedGradeA: Number(r.unworked_a),
      /**
       * Surfaced only on a clear majority AND enough leads to mean something.
       *
       * The share alone is not a signal: a week with three unworked leads that happen to
       * share a county reports 100% and reads as urgently as the week with 153. A note
       * that fires on noise stops being read, and the one case worth investigating goes
       * out with it.
       */
      ...(() => {
        const top = topByCohort.get(r.cohort);
        const share = top && top.total ? Math.round((top.n / top.total) * 100) : 0;
        const worthNaming = top && top.county && share >= 70 && top.total >= MIN_CLUSTER;
        return worthNaming
          ? { unworkedTopCounty: top!.county, unworkedTopCountyShare: share }
          : { unworkedTopCounty: null, unworkedTopCountyShare: null };
      })(),
    };
  });
}
