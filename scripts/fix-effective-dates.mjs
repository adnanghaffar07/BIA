/**
 * One-time (re-runnable, FREE) fix for effective / x-date logic.
 *
 * Frank's rule:
 *   Renewal  : effectiveDate = the lead's OWN origination M/DD, in the next
 *              renewal year (2026 for this slate). x-date = effectiveDate − 60.
 *   New biz  : effectiveDate = origination + 90 days. (no x-date)
 *
 * Origination date = first-mortgage recording date the pull filtered on, which
 * for these records is the stored recordingDate (falls back to lastSaleDate).
 * Previously every lead in a window was stamped the single window date — this
 * recomputes each lead individually. No REAPI calls, no credits.
 *
 * Usage:  node scripts/fix-effective-dates.mjs            (apply)
 *         node scripts/fix-effective-dates.mjs --dry-run  (report only)
 */
import { neon, Pool } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const DRY = process.argv.includes('--dry-run');
function readEnv(f) { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }
function getVar(k, c) { const m = c.match(new RegExp(`${k}=([^\\n]+)`)); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; }
const DATABASE_URL = getVar('DATABASE_URL', readEnv('.env')) || getVar('DATABASE_URL', readEnv('.env.local'));
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not found'); process.exit(1); }
const sql = neon(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL });

const RENEWAL_LEAD_DAYS = 60;
const NEW_BIZ_LEAD_DAYS = 90;

const ymd = (d) => d.toISOString().slice(0, 10);
const addDaysUTC = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

// today, normalized to UTC midnight
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const TODAY = new Date(ymd(dateArg ? new Date(dateArg.slice(7)) : new Date()));

/** Parse an origination string to a UTC-midnight Date (tz-stable). */
function parseOrig(s) {
  if (!s) return null;
  const d = new Date(typeof s === 'string' && s.length === 10 ? s + 'T00:00:00Z' : s);
  return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Renewal effective = origination M/DD in the next renewal year (this year if still ahead). */
function renewalEff(o) {
  let anniv = new Date(Date.UTC(TODAY.getUTCFullYear(), o.getUTCMonth(), o.getUTCDate()));
  if (anniv < TODAY) anniv = new Date(Date.UTC(TODAY.getUTCFullYear() + 1, o.getUTCMonth(), o.getUTCDate()));
  return anniv;
}

const leads = await sql`
  SELECT "propertyId", "engine", "recordingDate", "lastSaleDate", "effectiveDate"::text AS eff
  FROM "Lead" WHERE "engine" IN (1, 2)`;

console.log(`\n🛠  Fix effective/x-dates  ${DRY ? '(DRY RUN)' : '(APPLY)'}  · today=${ymd(TODAY)} · ${leads.length} leads`);
console.log('━'.repeat(64));

let fixed = 0, skipped = 0;
const sampleByEff = {};
for (const l of leads) {
  const o = parseOrig(l.recordingDate || l.lastSaleDate);
  if (!o) { skipped++; continue; }

  let eff, xdate = null;
  if (l.engine === 2) { const a = renewalEff(o); eff = ymd(a); xdate = addDaysUTC(a, -RENEWAL_LEAD_DAYS).toISOString(); }
  else { eff = ymd(addDaysUTC(o, NEW_BIZ_LEAD_DAYS)); }

  sampleByEff[eff] = (sampleByEff[eff] || 0) + 1;
  if (!DRY) {
    await pool.query(
      `UPDATE "Lead" SET "effectiveDate" = $1, "renewalTargetDate" = $2, "updatedAt" = NOW() WHERE "propertyId" = $3`,
      [eff, xdate, l.propertyId],
    );
  }
  fixed++;
}

console.log(`  ${DRY ? 'would fix' : 'fixed'} ${fixed}   skipped(no date) ${skipped}`);
console.log('\n  Renewal slate (Aug 2026) — eff date → count:');
Object.keys(sampleByEff).filter((k) => k.startsWith('2026-08')).sort()
  .forEach((k) => console.log(`     ${k} → ${sampleByEff[k]}`));
console.log(DRY ? '\n  (dry run — nothing written)' : '\n✅ Done (free — no credits).');
await pool.end();
