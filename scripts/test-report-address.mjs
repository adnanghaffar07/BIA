/**
 * Does every per-lead export carry a street address?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-report-address.mjs
 *
 * Reads only. Writes nothing and calls no vendor.
 *
 * -- Why this suite exists --------------------------------------------------
 * Frank, Sep-2026: the exports carried City and ZIP, which name a town rather than a
 * house. The fix is one field on QcRow and one column in the shared list, so it reaches
 * every report at once -- and that is exactly what makes it worth a test: the column comes
 * from rowOf(), which reads r.addressStreet, and most reports feed it SELECT *. The
 * Renewal Week report does NOT. It names its columns to avoid dragging the rawData blob
 * over ~10,000 leads, so a field added to rowOf is silently null there and the column
 * exports empty with no error anywhere.
 *
 * Asserting the key exists is not enough for that reason. This asserts the values are
 * actually populated, per report, which is the only form that catches a missing column in
 * a hand-written SELECT.
 */
import './lib/env.mjs';
import { getQcReport } from '@/services/reports.service';
import { leadsAtStage } from '@/services/recoveryPipeline.service';

const TYPES = ['referral','grade_overrides','keyword','roof_b','type_mismatch','owner_verify',
  'contact_coverage','skiptrace_mismatch','blast_skiptrace','cohort','reachability','call_outcome'];

let bad = 0;
for (const t of TYPES) {
  let rows;
  try { rows = await getQcReport(t, t === 'keyword' ? { q: 'trust' } : {}); }
  catch (e) { console.log(`${t.padEnd(20)} ERROR ${e.message}`); bad++; continue; }
  if (!rows.length) { console.log(`${t.padEnd(20)} (no rows)`); continue; }
  const hasKey = rows.every((r) => 'address' in r);
  const filled = rows.filter((r) => r.address).length;
  const sample = rows.find((r) => r.address)?.address ?? '(none non-null)';
  console.log(`${t.padEnd(20)} ${String(rows.length).padStart(5)} rows · key on all: ${hasKey} · non-null ${filled} · e.g. "${String(sample).slice(0,32)}"`);
  if (!hasKey) bad++;
  if (filled === 0) { console.log(`   ^^ every address is null — the column would export empty`); bad++; }
}

const pipe = await leadsAtStage('isolated');
const pr = Array.isArray(pipe) ? pipe : (pipe.rows ?? []);
console.log(`\nrecovery pipeline     ${String(pr.length).padStart(5)} rows · key on all: ${pr.every((r) => 'address' in r)} · non-null ${pr.filter((r) => r.address).length}`);
if (pr.length && !pr.every((r) => 'address' in r)) bad++;

console.log(bad ? `\n${bad} PROBLEM(S)` : '\nall report types carry a populated address');
