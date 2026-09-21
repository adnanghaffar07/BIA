/**
 * Trace the Grade A leads in a cohort that have never been skip traced.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/trace-untraced.mjs <from> <to>
 *         ... --apply            actually spend
 *         ... --limit N          cap the run
 *
 * ── Why this exists rather than the isolation pipeline ──────────────────────
 * The recovery pipeline is for leads that have BEEN traced and came back empty. These
 * have not been traced at all. Isolating them first would mark 195 leads "unreachable"
 * when the truth is nobody has looked yet, and the QC numbers would then report an
 * unstarted week as a failed one. So this runs the ordinary cohort-blast path —
 * traceAndApply, the same function the blast route calls — which records provenance,
 * activity and credits identically.
 *
 * ── Which vendor, and why not both ──────────────────────────────────────────
 * Tracerfy only. D-4 (the surviving tool) has not been issued, and of the two this is the
 * one whose billing is confirmed: 15 credits on a match, ZERO on a miss. So the downside
 * of guessing wrong is bounded — a wasted call on a lead we cannot match costs nothing.
 * BatchData's billing basis is still unconfirmed (M-4), and spending into an unknown rate
 * on 226 leads is not a decision to take on someone's behalf.
 *
 * traceAndApply falls back to BatchData when Tracerfy returns no email. That fallback is
 * DISABLED here (BATCHDATA_API_KEY blanked for the process) for the same reason. Run it
 * afterwards on whatever Tracerfy misses, once D-4 lands.
 *
 * ── Stopping ────────────────────────────────────────────────────────────────
 * An account fault — out of credits, rejected key — ends the run on the spot and reports
 * it. Everything below that point is untouched and still untraced, so the same command
 * picks up where this left off. A lead the vendor could not use (no insured name on file)
 * is skipped and counted, not treated as a reason to stop.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { insuredEmails } from '@/services/recipients.service';
import { traceAndApply } from '@/services/skipTraceApply.service';
import { isRunFatal } from '@/services/vendorErrors';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg ? Number(limitArg.split('=')[1] ?? args[args.indexOf(limitArg) + 1]) : Infinity;
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (dates.length !== 2) {
  console.error('Pass an effective-date window, e.g. 2026-11-16 2026-11-22');
  process.exit(1);
}
const [from, to] = dates;

// Tracerfy only — see the header.
delete process.env.BATCHDATA_API_KEY;

const CREDITS_PER_HIT = 15;

const rows = await sql`
  SELECT "id","propertyId","effectiveDate","grade","manualGrade","status",
         "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
         "addressStreet","addressCity","addressState","addressZip",
         "email1","email2","owner2Email","phone1","phone2","owner2Phone",
         "emailsAll","phonesAll","skipTraceData","deepSkipTracedAt"
    FROM "Lead"
   WHERE "effectiveDate" >= ${from} AND "effectiveDate" <= ${to}
     AND COALESCE("manualGrade","grade") = 'A'
     AND "deepSkipTracedAt" IS NULL
   ORDER BY "effectiveDate", "owner1LastName"`;

const named = rows.filter((r) => String(r.owner1FirstName ?? '').trim() && String(r.owner1LastName ?? '').trim());
const unnamed = rows.filter((r) => !(String(r.owner1FirstName ?? '').trim() && String(r.owner1LastName ?? '').trim()));
const alreadyReachable = named.filter((r) => insuredEmails(r).length > 0);
const target = named.filter((r) => insuredEmails(r).length === 0).slice(0, limit);

console.log(`\nWindow ${from} → ${to}`);
console.log(`  Grade A, never deep traced      : ${rows.length}`);
console.log(`  no insured name — Tracerfy can't: ${unnamed.length}   (needs the address-based tool)`);
console.log(`  already has an insured email    : ${alreadyReachable.length}   (nothing to gain)`);
console.log(`  TO TRACE                        : ${target.length}`);
console.log(`  cost ceiling                    : ${(target.length * CREDITS_PER_HIT).toLocaleString()} credits`
  + `  (a miss bills 0, so real spend lands below this)`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to spend.\n');
  process.exit(0);
}

const runId = `untraced-${from}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
let hit = 0, miss = 0, failed = 0, credits = 0, gainedEmail = 0, gainedPhone = 0;
let stopped = null;
let consecutive = 0;

for (const [i, lead] of target.entries()) {
  try {
    const out = await traceAndApply(lead, 'trace-untraced (system)', { runId });
    if (out.matched) hit++; else miss++;
    credits += out.credits ?? 0;
    if (out.recoveredEmail) gainedEmail++;
    if (out.recoveredPhone) gainedPhone++;
    consecutive = 0;
  } catch (err) {
    failed++;
    if (isRunFatal(err)) {
      stopped = { reason: err.fault, vendor: err.vendor, detail: err.detail, remaining: target.length - i - 1 };
      break;
    }
    if (++consecutive >= 3) {
      stopped = { reason: 'vendor_error', vendor: 'Tracerfy', detail: err?.message ?? 'three failures in a row', remaining: target.length - i - 1 };
      break;
    }
  }
  if ((i + 1) % 25 === 0) {
    console.log(`  … ${i + 1}/${target.length}  ·  ${hit} matched  ·  ${gainedEmail} gained an email  ·  ${credits} credits`);
  }
  // The vendor is a shared resource and this is not the only thing calling it.
  await new Promise((r) => setTimeout(r, 250));
}

console.log(`\nRun ${runId}`);
console.log(`  attempted            : ${hit + miss + failed}`);
console.log(`  matched              : ${hit}`);
console.log(`  no match             : ${miss}`);
console.log(`  errored              : ${failed}`);
console.log(`  GAINED AN INSURED EMAIL: ${gainedEmail}`);
console.log(`  gained a phone         : ${gainedPhone}`);
console.log(`  credits spent        : ${credits.toLocaleString()}`);
if (stopped) {
  console.log(`\n  STOPPED — ${stopped.vendor}: ${stopped.detail}`);
  console.log(`  ${stopped.remaining} lead(s) were not attempted and have not been charged.`);
}
