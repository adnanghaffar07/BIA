/**
 * Rebuild the pre-BatchData trace archive from the activity log.
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/restore-trace-archive.mjs
 *         ... --apply
 *
 * ── What happened ───────────────────────────────────────────────────────────
 * Until 18 Sep 2026 a trace REPLACED skipTraceData outright. A lead traced by Tracerfy and
 * then run through BatchData therefore lost Tracerfy's people — while keeping the columns
 * those people produced. That is why a card can show a co-insured (Christa Varnadoe, born
 * 1987) that the Skip Trace dialog cannot: the columns survived, the payload did not.
 *
 * ── What can honestly be rebuilt ────────────────────────────────────────────
 * Each trace wrote an activity carrying `emails`, `phones` and the `insuredPatch` it
 * applied. That gives back the contact VALUES and the co-insured's name and date of birth.
 *
 * It does NOT give back which person each address belonged to, nor carrier, rank, DNC
 * flags or household relatives — those were only ever in the raw payload.
 *
 * ── Why the rebuilt entry has no name ───────────────────────────────────────
 * Attribution is exactly what was lost, so the rebuilt record must not pretend to have it.
 * The entry carries a display label and leaves firstName/lastName empty, which means the
 * reachability rules will never match it as the insured. The addresses are therefore
 * VISIBLE again without any of them being newly credited to the named insured — inventing
 * that credit is how a report ends up promising reach the campaign cannot act on.
 */
import './lib/env.mjs';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const APPLY = process.argv.includes('--apply');
const client = await pool.connect();

try {
  // Leads whose payload is now BatchData's and carries no archive, together with the last
  // trace activity written BEFORE BatchData ran.
  const { rows } = await client.query(`
    SELECT DISTINCT ON (l."id")
           l."id",
           l."owner2FirstName", l."owner2LastName", l."owner2Dob",
           a."metadata"->'emails'       AS emails,
           a."metadata"->'phones'       AS phones,
           a."metadata"->'insuredPatch' AS patch,
           a."content"                  AS content,
           a."createdAt"                AS traced_at,
           l."skipTraceData"            AS payload
      FROM "Lead" l
      JOIN "Activity" a ON a."leadId" = l."id"
     WHERE l."skipTraceData"->>'provider' = 'batchdata'
       AND jsonb_array_length(COALESCE(l."skipTraceData"->'priorPersons','[]'::jsonb)) = 0
       AND a."type" = 'skip_trace'
       AND a."content" NOT ILIKE '%BatchData%'
     ORDER BY l."id", a."createdAt" DESC`);

  let rebuilt = 0;
  let nothingToRebuild = 0;

  for (const r of rows) {
    const emails = Array.isArray(r.emails) ? r.emails.map(String) : [];
    const phones = Array.isArray(r.phones) ? r.phones.map(String) : [];
    const patch = r.patch && typeof r.patch === 'object' ? r.patch : {};
    const coFirst = patch.owner2FirstName ?? r.owner2FirstName ?? null;
    const coLast = patch.owner2LastName ?? r.owner2LastName ?? null;
    const coDob = patch.owner2Dob ?? r.owner2Dob ?? null;

    // A trace that found nothing and patched nothing has nothing to restore.
    if (!emails.length && !phones.length && !coFirst && !coDob) { nothingToRebuild++; continue; }

    const entry = {
      // Deliberately unnamed — see the header. The dialog renders full_name.
      full_name: 'Tracerfy result (rebuilt — per-person detail not recoverable)',
      firstName: '',
      lastName: '',
      _foundBy: 'tracerfy',
      _reconstructed: true,
      _note: 'Rebuilt from the activity log after the original payload was replaced. '
        + 'Carrier, rank, DNC flags, household relatives and which person each address '
        + 'belonged to were not recorded and cannot be restored.',
      _tracedAt: r.traced_at,
      emails: emails.map((e) => ({ email: e })),
      phones: phones.map((p) => ({ phone: p })),
      ...(coFirst || coLast || coDob
        ? { coInsuredOnFile: [coFirst, coLast].filter(Boolean).join(' ') || null, coInsuredDob: coDob }
        : {}),
    };

    const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
    const next = { ...payload, priorPersons: [entry] };

    console.log(`${r.id}: rebuilding — ${emails.length} email(s), ${phones.length} phone(s)`
      + (coFirst ? `, co-insured ${coFirst} ${coLast ?? ''}`.trimEnd() : ''));

    if (APPLY) {
      await client.query(`UPDATE "Lead" SET "skipTraceData" = $2::jsonb WHERE "id" = $1`,
        [r.id, JSON.stringify(next)]);
      await client.query(
        `INSERT INTO "Activity" ("id","leadId","type","content","metadata","createdBy","createdAt")
         VALUES (gen_random_uuid()::text,$1,'note',$2,$3,'system: archive rebuild',NOW())`,
        [r.id,
         'Rebuilt the earlier Tracerfy trace record from the activity log — it had been replaced when BatchData ran',
         JSON.stringify({ rebuiltEmails: emails.length, rebuiltPhones: phones.length, coInsuredOnFile: coFirst ? `${coFirst} ${coLast ?? ''}`.trim() : null })],
      );
    }
    rebuilt++;
  }

  console.log(`\n${APPLY ? 'rebuilt' : 'would rebuild'} ${rebuilt} lead(s)`
    + `; ${nothingToRebuild} had nothing to restore (the earlier trace found nothing)`);
  if (!APPLY) console.log('DRY RUN — re-run with --apply.\n');
} finally {
  client.release();
  await pool.end();
}
