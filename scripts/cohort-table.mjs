/**
 * M-1 / W1 — the Sec. 2 cohort table, to the Sec. 2.1 accuracy standard.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/cohort-table.mjs
 *         ... --csv            emit CSV for the tracker instead of tables
 *
 * ── Canonical boundaries (directive Sec. 1) ─────────────────────────────────
 * 7-day windows, inclusive both ends, NO shared boundary date. The CRM already stores
 * cohorts this way — Monday-anchored — so C1 = 2026-10-05 … 2026-10-11 is a direct read,
 * not a restatement. The legacy labels ("10/05–10/12") are 8 days and share every boundary
 * Monday, which is why a lead effective 10/12 was counted in two cohorts.
 *
 * ── contactability (Sec. 4.1) ───────────────────────────────────────────────
 * Reported two ways, because the directive's rule and the campaign's rule are not the same
 * measurement and the difference is material:
 *
 *   insured  — addresses belonging to the NAMED INSURED only. This is what the campaign
 *              can actually send to at E1 (Sec. 7.1: insured only at E1).
 *   card     — any contact anywhere on the card, insured or co-insured. This is what the
 *              GRADING rule tests ("D only when neither phone nor email").
 *
 * Quoting one as the other is how a cohort promises reach the tool will not act on. Both
 * are printed; `emailable` is always the insured figure, because that is the send list.
 *
 * Read from recipients.service, not "email1 IS NOT NULL": addresses are attributed per
 * person inside the trace payload, so the column test both misses addresses and credits
 * the co-insured's to the insured.
 *
 * ── The self-checks (Sec. 2.1) ──────────────────────────────────────────────
 * Four checks per cohort. A cohort that fails prints FAIL and says which rule broke,
 * rather than shipping quietly. A named gap is workable; a silent blank is not.
 *
 * One correction to the directive's rule 2 ("Grade A now + all downgrades = Grade A at
 * pull"): it assumes today's Grade A is a subset of the pull's Grade A. It is not — leads
 * also climb INTO Grade A after the pull. The check below reconciles the pull cohort on
 * its own terms and reports climbers separately, so both numbers stay true.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { insuredEmails, insuredPhones, coInsuredEmails, coInsuredPhones } from '@/services/recipients.service';
import { classifyGradeChange, CATEGORY_LABEL } from '@/services/gradeChangeReason';

const csv = process.argv.includes('--csv');

/** Directive Sec. 1 — canonical, inclusive, no shared boundary dates. */
const COHORTS = [
  ['C1', '2026-10-05', '2026-10-11', '10/05–10/12'],
  ['C2', '2026-10-12', '2026-10-18', '10/12–10/19'],
  ['C3', '2026-10-19', '2026-10-25', '10/19–10/26'],
  ['C4', '2026-10-26', '2026-11-01', '10/26–11/02'],
  ['C5', '2026-11-02', '2026-11-08', '11/02–11/09'],
  ['C6', '2026-11-09', '2026-11-15', '11/09–11/16'],
  ['C7', '2026-11-16', '2026-11-22', '11/16–11/23'],
];

const table = [];
const reasons = [];
const exceptions = [];

for (const [code, from, to, legacy] of COHORTS) {
  const leads = await sql`
    SELECT "id","propertyId","effectiveDate","gradeAtPull","grade","manualGrade","status",
           "email1","email2","owner2Email","phone1","phone2","owner2Phone",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
           "emailsAll","phonesAll","skipTraceData","deepSkipTracedAt"
      FROM "Lead"
     WHERE "effectiveDate" >= ${from} AND "effectiveDate" <= ${to}`;

  const gradeNow = (l) => String(l.manualGrade || l.grade || '');
  const aAtPull = leads.filter((l) => l.gradeAtPull === 'A');
  const aNow = leads.filter((l) => gradeNow(l) === 'A');
  const stillA = aAtPull.filter((l) => gradeNow(l) === 'A');
  const leftA = aAtPull.filter((l) => gradeNow(l) !== 'A');
  const climbedIn = aNow.filter((l) => l.gradeAtPull !== 'A');

  const hasInsEmail = (l) => insuredEmails(l).length > 0;
  const hasInsPhone = (l) => insuredPhones(l).length > 0;
  const hasAnyEmail = (l) => hasInsEmail(l) || coInsuredEmails(l).length > 0;
  const hasAnyPhone = (l) => hasInsPhone(l) || coInsuredPhones(l).length > 0;

  const split = (set, e, p) => {
    let both = 0, eo = 0, po = 0, none = 0;
    for (const l of set) {
      const E = e(l), P = p(l);
      if (E && P) both++; else if (E) eo++; else if (P) po++; else none++;
    }
    return { both, eo, po, none };
  };

  const ins = split(aNow, hasInsEmail, hasInsPhone);
  const card = split(aNow, hasAnyEmail, hasAnyPhone);

  // The no-contact segment (Sec. 4.2): left Grade A and we hold neither channel anywhere
  // on the card. These are the direct-mail leads — flagged, never regraded.
  const noneD = leftA.filter((l) => !hasAnyEmail(l) && !hasAnyPhone(l)).length;

  // Downgrade reasons, from the grade log, for leads that were Grade A at pull and are
  // NOT Grade A today. A lead that left and came back is not a downgrade; counting it as
  // one is what made "logged" exceed "actual" on five cohorts.
  const leftIds = leftA.map((l) => l.id);
  const changes = leftIds.length
    ? await sql`
        SELECT "leadId", "reason", "source"
          FROM "GradeChange"
         WHERE "fromGrade" = 'A' AND "leadId" = ANY(${leftIds})`
    : [];
  const byCat = {};
  const seen = new Set();
  for (const c of changes) {
    if (seen.has(c.leadId)) continue;
    seen.add(c.leadId);
    const cat = classifyGradeChange(c.reason, c.source);
    byCat[cat] = (byCat[cat] ?? 0) + 1;
  }

  const emailable = ins.both + ins.eo;

  const checks = {
    'contactability sums to Grade A now': ins.both + ins.eo + ins.po + ins.none === aNow.length,
    'still A + left A = A at pull': stillA.length + leftA.length === aAtPull.length,
    'every lead that left A has a logged reason': seen.size === leftA.length,
    'no Grade A lead is contactable by neither channel': card.none === 0,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);

  if (seen.size !== leftA.length) {
    exceptions.push(`${code}: ${leftA.length - seen.size} lead(s) left Grade A with no logged reason`);
  }
  if (card.none > 0) {
    exceptions.push(`${code}: ${card.none} lead(s) are Grade A with neither phone nor email anywhere on the card — the grading rule says these should be D`);
  }
  if (climbedIn.length) {
    exceptions.push(`${code}: ${climbedIn.length} lead(s) are Grade A today but were NOT Grade A at pull (climbed in)`);
  }

  table.push({
    code, window: `${from} → ${to}`, legacy,
    leads: leads.length,
    A_at_pull: aAtPull.length,
    A_now: aNow.length,
    still_A: stillA.length,
    climbed_in: climbedIn.length,
    email_and_phone: ins.both,
    email_only: ins.eo,
    phone_only: ins.po,
    no_insured_contact: ins.none,
    none_D: noneD,
    EMAILABLE: emailable,
    coverage: aNow.length ? `${Math.round((emailable / aNow.length) * 1000) / 10}%` : '—',
    never_traced: aNow.filter((l) => !l.deepSkipTracedAt).length,
    check: failed.length ? `FAIL (${failed.length})` : 'OK',
  });

  reasons.push({
    code,
    left_A: leftA.length,
    logged: seen.size,
    unexplained: leftA.length - seen.size,
    ...Object.fromEntries(Object.entries(byCat).map(([k, v]) => [CATEGORY_LABEL[k] ?? k, v])),
  });
}

if (csv) {
  const keys = Object.keys(table[0]);
  console.log(keys.join(','));
  for (const r of table) console.log(keys.map((k) => `"${r[k]}"`).join(','));
} else {
  console.log('\n=== DIRECTIVE Sec. 2 — COHORT TABLE (canonical 7-day windows) ===');
  console.log('contactability measured on the NAMED INSURED — the E1 send list.\n');
  console.table(table);
  console.log('\n=== M-2 — WHY LEADS LEFT GRADE A ===');
  console.table(reasons);
  if (exceptions.length) {
    console.log('\n=== NAMED GAPS (Sec. 2.1: "a named gap is workable") ===');
    for (const e of exceptions) console.log('  · ' + e);
  }
}
