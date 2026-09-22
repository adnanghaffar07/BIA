/**
 * Close out the Grade A leads nobody can contact (Frank, Sep-2026).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/regrade-uncontactable.mjs           DRY RUN
 *   node --import ./scripts/lib/register-ts.mjs scripts/regrade-uncontactable.mjs --apply   for real
 *
 * Two phases, in this order and not the other:
 *
 *   1. TRACE the handful that have never been traced. Real people, renewal still ahead,
 *      15 credits each on a hit and nothing on a miss.
 *   2. RE-GRADE everything that has been traced and still has no phone and no email
 *      anywhere on the card. The rule already says these are D; nothing ever re-ran it
 *      after the trace, so the A is frozen from before we knew better.
 *
 * Tracing first matters: a lead that comes back empty in phase 1 becomes a phase 2
 * candidate in the same run, and doing it the other way round would re-grade a lead we
 * were about to find an address for.
 *
 * ── What this will not do ───────────────────────────────────────────────────
 * It never re-traces. A lead carrying deepSkipTracedAt has already been asked, and asking
 * the same vendor about the same address returns what it returned last time — 146 of them
 * would be 2,190 credits for nothing.
 *
 * It never traces an entity. A trust has no natural person to look up (see
 * src/lib/ownerEntity.ts), and the blocker refuses it anyway.
 *
 * It never touches a lead whose renewal has passed, and never overrides a manual grade —
 * a producer's call is a decision, not drift.
 *
 * The grade is COMPUTED, not asserted. If the rules say something other than D, the rules
 * win; asserting D would make the grade a label instead of a result.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { updateLead, addActivity, getLeadByPropertyId } from '@/services/storage.service';
import { traceAndApply, skipTraceBlocker } from '@/services/skipTraceApply.service';
import { calculateLeadGrade } from '@/services/grade.service';
import { recordGradeChange } from '@/services/gradeHistory.service';
import { insuredEmails, insuredPhones, coInsuredEmails, coInsuredPhones } from '@/services/recipients.service';
import { ownerEntityOf } from '@/lib/ownerEntity';
import { isRunFatal } from '@/services/vendorErrors';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'system: uncontactable sweep';
const TODAY = new Date().toISOString().slice(0, 10);
const FROM = '2026-10-05', TO = '2026-11-22';   // C1 … C7

const hasContact = (l) => !!(insuredEmails(l).length || insuredPhones(l).length ||
                             coInsuredEmails(l).length || coInsuredPhones(l).length);
const gradeNow = (l) => String(l.manualGrade || l.grade || '');
const traced = (l) => l.skipTraced === true || l.deepSkipTracedAt != null;
const name = (l) => [l.owner1FirstName, l.owner1LastName].filter(Boolean).join(' ').trim();

console.log(APPLY ? '*** APPLYING — this spends credits and changes grades ***' : '--- DRY RUN (pass --apply to write) ---');
console.log(`cohort range ${FROM} … ${TO} · today ${TODAY}\n`);

const all = await sql`
  SELECT * FROM "Lead"
   WHERE "effectiveDate" >= ${FROM} AND "effectiveDate" <= ${TO}`;

/* ── phase 1 — trace the never-traced ─────────────────────────────────────── */
const toTrace = all.filter((l) =>
  gradeNow(l) === 'A' && !hasContact(l) && !traced(l) && !ownerEntityOf(l)
  && String(l.effectiveDate).slice(0, 10) >= TODAY);

console.log(`PHASE 1 — trace ${toTrace.length} lead(s), up to ${toTrace.length * 15} credits`);
let found = 0, empty = 0, traceFailed = 0;
for (const l of toTrace) {
  const blocked = skipTraceBlocker(l, { grades: ['A', 'B', 'C'] });
  if (blocked) { console.log(`  SKIP ${l.id} — ${blocked}`); continue; }
  console.log(`  ${APPLY ? 'tracing' : 'would trace'} ${l.id}  ${String(l.effectiveDate).slice(0, 10)}  ${name(l)}`);
  if (!APPLY) continue;
  try {
    // traceAndApply writes the contact columns AND its own Activity row.
    const out = await traceAndApply(l, ACTOR);
    out.matched && (out.recoveredEmail || out.recoveredPhone) ? found++ : empty++;
    console.log(`      -> matched=${out.matched} email=${out.recoveredEmail} phone=${out.recoveredPhone} credits=${out.credits}`);
    await new Promise((r) => setTimeout(r, 250));
  } catch (err) {
    traceFailed++;
    console.log(`      -> FAILED: ${err?.message ?? err}`);
    if (isRunFatal(err)) { console.error('      vendor refused — stopping phase 1'); break; }
  }
}
if (APPLY) console.log(`  gained contact ${found} · still empty ${empty} · failed ${traceFailed}`);

/* ── phase 2 — re-grade the traced-and-still-empty ────────────────────────── */
// Re-read: phase 1 just changed some of these rows.
const after = await sql`
  SELECT * FROM "Lead"
   WHERE "effectiveDate" >= ${FROM} AND "effectiveDate" <= ${TO}`;

const candidates = after.filter((l) =>
  String(l.grade ?? '') === 'A'        // stored grade, not effective — manualGrade handled below
  && !l.manualGrade                    // a producer's call is a decision, not drift
  && !hasContact(l)
  && traced(l));

const manualHeld = after.filter((l) => l.manualGrade === 'A' && !hasContact(l) && traced(l));

console.log(`\nPHASE 2 — ${candidates.length} traced lead(s) with no contact anywhere`);
if (manualHeld.length) {
  console.log(`  (${manualHeld.length} more are Grade A BY HAND — left alone, a producer set those)`);
}

const moves = {};
let regraded = 0;
for (const l of candidates) {
  const computed = calculateLeadGrade(l);
  moves[computed] = (moves[computed] ?? 0) + 1;
  if (computed === l.grade) continue;
  if (!APPLY) continue;

  await updateLead(l.propertyId ?? l.id, { grade: computed });
  await recordGradeChange({
    leadId: l.id,
    fromGrade: l.grade ?? null,
    toGrade: computed,
    source: 'system',
    reason: 'No phone and no email after skip trace — unworkable',
    changedBy: ACTOR,
  });
  await addActivity(
    l.id,
    'grade_system',
    `Grade ${l.grade} → ${computed}. Skip trace returned no phone and no email for the `
    + 'insured or the co-insured, so the lead cannot be contacted on any channel. '
    + 'Re-graded by the standing rule, which had not been re-run since the trace.',
    {
      changes: [{ field: 'Grade', from: l.grade, to: computed }],
      reason: 'uncontactable_after_trace',
      tracedAt: l.deepSkipTracedAt ?? null,
      sweep: 'uncontactable',
    },
    ACTOR,
  );
  regraded++;
}

console.log(`  the rule says: ${JSON.stringify(moves)}`);
console.log(APPLY ? `  re-graded ${regraded}` : `  would re-grade ${candidates.filter((l) => calculateLeadGrade(l) !== l.grade).length}`);

/* ── where that leaves the headline number ────────────────────────────────── */
const fin = await sql`
  SELECT COUNT(*) FILTER (WHERE COALESCE("manualGrade","grade") = 'A')::int AS a
    FROM "Lead" WHERE "effectiveDate" >= ${FROM} AND "effectiveDate" <= ${TO}`;
const reach = after.filter((l) => gradeNow(l) === 'A' && insuredEmails(l).length > 0).length;
console.log(`\nGrade A in C1-C7 ${APPLY ? 'now' : 'currently'}: ${fin[0].a}`);
console.log(`Reachable by email at the insured: ${reach} ${APPLY ? '' : '(unchanged by this sweep either way)'}`);
if (!APPLY) console.log('\nNothing was written. Re-run with --apply.');
