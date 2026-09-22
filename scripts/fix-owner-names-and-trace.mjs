/**
 * Four owner names split by hand, then traced (Frank / Abdullah, Sep-2026).
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/fix-owner-names-and-trace.mjs           DRY RUN
 *   node --import ./scripts/lib/register-ts.mjs scripts/fix-owner-names-and-trace.mjs --apply   for real
 *
 * These four leads carry a whole two-owner string in "owner1LastName" with no first name
 * at all — "Busch, Michael A & Demarco,Shari Ann" — so skipTraceBlocker correctly refused
 * to trace them: the enhanced lookup keys off a first and last name, and there is none.
 *
 * ── Why this is a hand-written table and not a parser ───────────────────────
 * 99 leads share the shape and their formats disagree. "Busch, Michael A & Demarco,Shari
 * Ann" is Last,First & Last,First. "Anthony Debenedetto & Leslie Dibenedetto" is First
 * Last & First Last — the same separator, the opposite order. "Soccoa, S & D & Lindsay, R
 * & M" resolves to nothing certain, and "Secretary Of Housing & Urban Development" is a
 * government body rather than two people.
 *
 * A parser that handled the first form would silently invert the second, writing Leslie's
 * given name as a surname. That is worse than leaving it alone: a wrong first name sent to
 * the vendor returns a real phone number belonging to somebody else, and the lead then
 * looks reachable. So the four below are transcribed individually and each one is checked
 * against the string on file before anything is written.
 *
 * The fifth of the original group, 332281740 ("Chowdaribhushaiah,T & Darapaneni, M"),
 * is deliberately absent — both first names are bare initials, which is not a first name
 * the trace can use.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { updateLead, addActivity } from '@/services/storage.service';
import { traceAndApply, skipTraceBlocker } from '@/services/skipTraceApply.service';
import { calculateLeadGrade } from '@/services/grade.service';
import { recordGradeChange } from '@/services/gradeHistory.service';
import { insuredEmails, insuredPhones, coInsuredEmails, coInsuredPhones } from '@/services/recipients.service';
import { isRunFatal } from '@/services/vendorErrors';

const APPLY = process.argv.includes('--apply');
const ACTOR = 'system: owner name split';

/**
 * `expect` is the exact string that must still be in owner1LastName. If the data has moved
 * on since this was written, that lead is skipped rather than overwritten — the whole point
 * of transcribing by hand is that these are specific records, not a pattern.
 */
const FIXES = [
  {
    id: '189972977',
    expect: 'Busch, Michael A & Demarco,Shari Ann',
    o1First: 'Michael A', o1Last: 'Busch',
    o2First: 'Shari Ann', o2Last: 'Demarco',
  },
  {
    id: '326396392',
    expect: 'Barbin,Howard & Parziale,Fiordaliza',
    o1First: 'Howard', o1Last: 'Barbin',
    o2First: 'Fiordaliza', o2Last: 'Parziale',
  },
  {
    id: '37598269',
    expect: 'Dylewska, Dorota & Dylewska,Izabela',
    o1First: 'Dorota', o1Last: 'Dylewska',
    o2First: 'Izabela', o2Last: 'Dylewska',
  },
  {
    id: '28974292',
    expect: 'Kuletski,Vladimir & Kuletskaya,T',
    o1First: 'Vladimir', o1Last: 'Kuletski',
    // The co-insured's given name is only an initial on the tax roll. Recorded as it
    // stands rather than invented — the insured is who the trace keys off.
    o2First: 'T', o2Last: 'Kuletskaya',
  },
  {
    // Added after the first four. Renews 03 Oct — two days BEFORE C1 opens, so it never
    // appears in the C1-C7 figures and was only found by looking at unparsed names across
    // the whole book rather than inside Frank's range.
    id: '189403251',
    expect: 'Farooq, Muhammed S & Butt,Nayab T',
    o1First: 'Muhammed S', o1Last: 'Farooq',
    o2First: 'Nayab T', o2Last: 'Butt',
  },
];

const hasContact = (l) => !!(insuredEmails(l).length || insuredPhones(l).length ||
                             coInsuredEmails(l).length || coInsuredPhones(l).length);

console.log(APPLY ? '*** APPLYING — edits owner names and spends credits ***' : '--- DRY RUN (pass --apply to write) ---');
console.log(`${FIXES.length} lead(s), up to ${FIXES.length * 15} credits\n`);

let fixed = 0, skipped = 0, traced = 0, gained = 0, empty = 0, regraded = 0;

for (const f of FIXES) {
  const [lead] = await sql`SELECT * FROM "Lead" WHERE "id" = ${f.id}`;
  if (!lead) { console.log(`  SKIP ${f.id} — not found`); skipped++; continue; }

  const onFile = String(lead.owner1LastName ?? '');
  if (onFile !== f.expect) {
    console.log(`  SKIP ${f.id} — on file is ${JSON.stringify(onFile)}, expected ${JSON.stringify(f.expect)}`);
    skipped++; continue;
  }

  console.log(`  ${f.id}  ${JSON.stringify(onFile)}`);
  console.log(`      insured    -> ${f.o1First} ${f.o1Last}`);
  console.log(`      co-insured -> ${f.o2First} ${f.o2Last}`);
  if (!APPLY) { continue; }

  await updateLead(lead.propertyId ?? lead.id, {
    owner1FirstName: f.o1First, owner1LastName: f.o1Last,
    owner2FirstName: f.o2First, owner2LastName: f.o2Last,
  });
  await addActivity(
    lead.id,
    'data_correction',
    `Owner name split by hand. The tax-roll string "${onFile}" held both owners in the `
    + `surname field with no first name, so skip trace could not run. Recorded as `
    + `insured "${f.o1First} ${f.o1Last}" and co-insured "${f.o2First} ${f.o2Last}". `
    + 'Transcribed individually, not parsed — the same separator means different things '
    + 'on other records.',
    { changes: [{ field: 'Owner name', from: onFile, to: `${f.o1First} ${f.o1Last} + ${f.o2First} ${f.o2Last}` }], source: 'manual_split' },
    ACTOR,
  );
  fixed++;

  // Re-read so the trace sees the corrected name.
  const [ready] = await sql`SELECT * FROM "Lead" WHERE "id" = ${f.id}`;
  const blocked = skipTraceBlocker(ready, { grades: ['A', 'B', 'C'] });
  if (blocked) { console.log(`      still blocked: ${blocked}`); continue; }

  try {
    const out = await traceAndApply(ready, ACTOR);
    traced++;
    const got = out.matched && (out.recoveredEmail || out.recoveredPhone);
    got ? gained++ : empty++;
    console.log(`      trace -> matched=${out.matched} email=${out.recoveredEmail} phone=${out.recoveredPhone} credits=${out.credits}`);

    // Same rule the 146 went through: traced and still uncontactable is not a Grade A.
    const [post] = await sql`SELECT * FROM "Lead" WHERE "id" = ${f.id}`;
    if (!post.manualGrade && !hasContact(post)) {
      const computed = calculateLeadGrade(post);
      if (computed !== post.grade) {
        await updateLead(post.propertyId ?? post.id, { grade: computed });
        await recordGradeChange({
          leadId: post.id, fromGrade: post.grade ?? null, toGrade: computed,
          source: 'system',
          reason: 'No phone and no email after skip trace — unworkable',
          changedBy: ACTOR,
        });
        await addActivity(
          post.id, 'grade_system',
          `Grade ${post.grade} → ${computed}. The name was corrected and the skip trace run, `
          + 'and it still returned no phone and no email on any channel.',
          { changes: [{ field: 'Grade', from: post.grade, to: computed }], reason: 'uncontactable_after_trace' },
          ACTOR,
        );
        regraded++;
        console.log(`      re-graded ${post.grade} → ${computed}`);
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  } catch (err) {
    console.log(`      trace FAILED: ${err?.message ?? err}`);
    if (isRunFatal(err)) { console.error('      vendor refused — stopping'); break; }
  }
}

console.log(`\nnames fixed ${fixed} · skipped ${skipped} · traced ${traced} · gained contact ${gained} · still empty ${empty} · re-graded ${regraded}`);
if (!APPLY) console.log('\nNothing was written. Re-run with --apply.');
