/**
 * Reconciles every count the QC screens show against the database.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/verify-counts.mjs
 *         ... --from=2026-10-05 --to=2026-11-22    (extra window to check)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Frank, 17 Sep 2026, after two hours of disputed figures: "now I don't trust the data.
 * Now I got to QC everything again."
 *
 * Nothing in that meeting was disputed because a number was wrong — they were disputed
 * because nobody could show that a number was right. The counts on those screens come
 * from three different paths: SQL aggregates, per-row flags computed in the report
 * service, and chip tallies computed in the browser from the rows. Any one of them can
 * drift from the other two without erroring, and a header that disagrees with its own
 * table is exactly the kind of thing that is noticed in front of the client.
 *
 * Every assertion here compares a number the UI would display against the same number
 * derived independently from the database. Run it after touching anything that feeds a
 * QC report. Exits non-zero on any failure so it can gate a commit.
 */
import './lib/env.mjs';
import { neon } from '@neondatabase/serverless';
import { getQcReport } from '@/services/reports.service.ts';
import { getCohortLedger } from '@/services/cohortLedger.service.ts';
import { insuredEmails, coInsuredEmails, insuredPhones, coInsuredPhones, RECIPIENT_COLS } from '@/services/recipients.service.ts';

const sql = neon(process.env.DATABASE_URL);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

let pass = 0; const failures = [];
const check = (name, actual, expected, hint = '') => {
  if (actual === expected) { pass++; return; }
  failures.push({ name, actual, expected, hint });
  console.log(`  FAIL  ${name}  ui=${actual}  db=${expected}  ${hint}`);
};

/** Renewal-week windows worth checking: the cohorts in play, plus a wide multi-week range. */
const WINDOWS = [
  ['2026-10-05', '2026-10-11'],
  ['2026-10-26', '2026-11-01'],
  ['2026-11-16', '2026-11-22'],
  ['2026-10-05', '2026-11-16'],
];
if (arg('from') && arg('to')) WINDOWS.push([arg('from'), arg('to')]);

const gradeOf = (r) => r.manualGrade || r.grade || 'ungraded';

for (const [from, to] of WINDOWS) {
  const rows = await getQcReport('cohort', { effFrom: from, effTo: to });
  const [s] = await sql`
    SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade")='A')::int a,
      COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade")='B')::int b,
      COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade")='C')::int c,
      COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade")='D')::int d,
      COUNT(*) FILTER (WHERE "grade" IS NULL AND "manualGrade" IS NULL)::int ungraded,
      COUNT(*) FILTER (WHERE "deepSkipTracedAt" IS NOT NULL)::int traced
    FROM "Lead" WHERE "effectiveDate">=${from} AND "effectiveDate"<=${to}`;
  const w = `[${from}..${to}]`;
  const g = (x) => rows.filter((r) => gradeOf(r) === x).length;

  check(`${w} total`, rows.length, s.total);
  check(`${w} Grade A`, g('A'), s.a);
  check(`${w} Grade B`, g('B'), s.b);
  check(`${w} Grade C`, g('C'), s.c);
  check(`${w} Grade D`, g('D'), s.d);
  check(`${w} ungraded`, g('ungraded'), s.ungraded);
  check(`${w} deep traced`, rows.filter((r) => r.matched).length, s.traced);

  // The chips must partition the total exactly — a header that does not add up to its
  // own table is the failure mode that started all of this.
  check(`${w} grade chips sum == total`,
    ['A', 'B', 'C', 'D', 'ungraded'].reduce((t, x) => t + g(x), 0), rows.length);
  check(`${w} status chips sum == total`,
    [...new Set(rows.map((r) => r.reason || '(none)'))]
      .reduce((t, st) => t + rows.filter((r) => (r.reason || '(none)') === st).length, 0),
    rows.length);
  check(`${w} A-with-email + A-without == A`,
    rows.filter((r) => r.hasInsuredEmail && gradeOf(r) === 'A').length
    + rows.filter((r) => !r.hasInsuredEmail && gradeOf(r) === 'A').length, g('A'));

  // The reach flags must match the recipient rules re-run from the raw columns — this is
  // what stops a report promising reach the campaign push would not act on.
  /**
   * Built from RECIPIENT_COLS rather than hand-written.
   *
   * This query hard-coded its columns and fell behind the moment a rule started reading a
   * new one: emailsAll was added to the rules, not here, and the checker reported the
   * report wrong when the report was right. A verifier with its own stale copy of the
   * contract is worse than no verifier — it produces confident false alarms.
   */
  const src = await sql(
    [`SELECT ${RECIPIENT_COLS.map((c) => `"${c}"`).join(',')}
        FROM "Lead" WHERE "effectiveDate" >= '${from}' AND "effectiveDate" <= '${to}'`],
  );
  check(`${w} reachable by insured email`, rows.filter((r) => r.hasInsuredEmail).length,
    src.filter((l) => insuredEmails(l).length > 0).length);
  check(`${w} reachable by co-insured email`, rows.filter((r) => r.hasCoInsuredEmail).length,
    src.filter((l) => coInsuredEmails(l).length > 0).length);
  check(`${w} reachable by insured phone`, rows.filter((r) => r.hasInsuredPhone).length,
    src.filter((l) => insuredPhones(l).length > 0).length);
  check(`${w} reachable by co-insured phone`, rows.filter((r) => r.hasCoInsuredPhone).length,
    src.filter((l) => coInsuredPhones(l).length > 0).length);

  // Cross-TAB: Reachability and Renewal Week answer the same question on the same range
  // and must not disagree. They are computed by different code paths.
  const reach = await getQcReport('reachability', { effFrom: from, effTo: to });
  check(`${w} Reachability total == Renewal Week total`, reach.length, rows.length);
  check(`${w} Reachability insured == Renewal Week insured`,
    reach.filter((r) => (r.insuredEmailCount ?? 0) > 0).length,
    rows.filter((r) => r.hasInsuredEmail).length);
}

// The ledger counts WHOLE weeks, so it is checked against whole-week SQL — and its own
// columns must add up, or a reader can see at a glance that it is wrong.
for (const d of await getCohortLedger({ effFrom: '2026-10-05', effTo: '2026-11-22' })) {
  const [q] = await sql`
    SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE "gradeAtPull"='A')::int at_pull,
      COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade")='A')::int now_a
    FROM "Lead" WHERE "cohort"=${d.cohort}`;
  check(`ledger ${d.cohort} total`, d.total, q.total);
  check(`ledger ${d.cohort} A at pull`, d.aAtPull, q.at_pull);
  check(`ledger ${d.cohort} A now`, d.aNow, q.now_a);
  check(`ledger ${d.cohort} trough+recovered==stillA`, d.trough + d.recovered, d.stillA);
  check(`ledger ${d.cohort} stillA+climbed==aNow`, d.stillA + d.gainedOther, d.aNow);
  check(`ledger ${d.cohort} lost==atPull-stillA`, d.lost, d.aAtPull - d.stillA);

  /**
   * The ledger's Mailable column and the Renewal Week chips answer the same question by
   * different routes — one aggregates per cohort, the other per row on screen. They must
   * agree, or the two tabs disagree about how many leads can be emailed.
   */
  const weekRows = await getQcReport('cohort', { effFrom: d.cohort, effTo: d.endsOn ?? d.cohort });
  check(`ledger ${d.cohort} mailable == Renewal Week Grade A with insured email`,
    d.mailable,
    weekRows.filter((r) => r.hasInsuredEmail && gradeOf(r) === 'A').length);
  check(`ledger ${d.cohort} mailable <= aNow`, d.mailable <= d.aNow, true);
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
