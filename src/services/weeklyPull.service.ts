import { API_CONFIG, REAPI_BASE_FILTERS, REAPI_TARGET_ZIPS } from '@/lib/constants';
import sql, { pool } from '@/lib/neon';
import {
  computePullWindows,
  RENEWAL_PULL_LEAD_DAYS,
  PullWindow,
} from './pipeline.service';
import { upsertLeads, getExistingPropertyIds, updateLead } from './storage.service';
import { enrichLeadBatch } from './enrichment.service';
import { fetchPropertyDetailPatch } from './propertyDetail.service';

// Frank Aug-2026: after the weekly pull grades leads, run the granular REAPI
// PropertyDetail call on every NEW Grade-A SINGLE-FAMILY lead (condos excluded) to
// fill bath split, garage type/count, basement finish %, and the original mortgage
// amount. Costs 1 credit per lead. Flip to false to disable the whole step.
const ENRICH_GRADE_A_WITH_DETAIL = true;
const DETAIL_GAP_MS = 300; // small courtesy gap between PropertyDetail calls

/**
 * Weekly REAPI pull (Frank Jun-2026) — credit-efficient, de-duplicated.
 *
 * For each rolling 7-day window (1 new-biz + 4 renewal years, see
 * computePullWindows):
 *   Phase A  ids_only search ............ FREE — discover candidate property IDs
 *   de-dup   diff vs stored propertyIds .. records we already have cost nothing
 *   Phase B  full pull of NEW ids only ... CREDITS — only brand-new properties
 *   resurface existing renewals ......... FREE — refresh anniversary/x-date so a
 *                                          previously-pulled renewal re-enters the
 *                                          queue on its new cycle (no re-charge)
 *
 * dryRun stops after Phase A so we can report exact credit cost before spending.
 */

// BIA target ZIPs + permanent appetite filters — single definition in lib/constants
// so every pull path (weekly, manual, seed) sources identically.
const BASE_FILTERS = { ...REAPI_BASE_FILTERS, zip: REAPI_TARGET_ZIPS } as const;

const FULL_PULL_BATCH = 100; // PropertySearch full-data page size

async function reapiSearch(body: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_CONFIG.BASE_URL}/PropertySearch`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': API_CONFIG.API_KEY,
      'x-user-id': API_CONFIG.USER_ID,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`REAPI ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Phase A — FREE. Return all candidate property IDs for a window's origination range. */
async function scanWindowIds(w: PullWindow): Promise<string[]> {
  const data = await reapiSearch({
    ids_only: true, // ← no credits charged
    size: 10000,
    ...BASE_FILTERS,
    // Sale date is the single anchor (Frank Jun-2026): the date we filter on is the
    // same one we store, display, and derive the effective date from.
    last_sale_date_min: w.originationMin,
    last_sale_date_max: w.originationMax,
  });
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.map((x: any) => String(x?.id ?? x));
}

/** Phase B — CREDITS. Pull full property data for specific IDs only, batched. */
async function fetchFullByIds(ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += FULL_PULL_BATCH) {
    const chunk = ids.slice(i, i + FULL_PULL_BATCH);
    const data = await reapiSearch({
      ids_only: false,
      size: chunk.length,
      ids: chunk, // verified: PropertySearch returns full data for exactly these IDs
    });
    if (Array.isArray(data.data)) out.push(...data.data);
  }
  return out;
}

/**
 * FREE — stamp the window's effective + x-date onto matched stored leads.
 *
 * The effective date comes from the WINDOW, not the per-lead deed `recordingDate`:
 * every lead was filtered to a first-mortgage origination inside the window, but the
 * PropertySearch summary does not expose that mortgage date and the deed date is a
 * different/later date. So all leads in a window share its effective/anniversary
 * window. For renewals this also re-surfaces a prior-year pull onto its new cycle
 * (no REAPI call, no credits).
 */
async function applyWindowDates(ids: string[], w: PullWindow): Promise<number> {
  if (!ids.length) return 0;

  // Each lead's effective date is ITS OWN sale-date anniversary — the same month/day
  // as lastSaleDate, in the window's year (Frank Jun-2026: sale date is the single
  // anchor; the date we filter on is the one we store, display and work from).
  //
  // This previously stamped every lead in the window with `w.effectiveMin`, which
  // collapsed a whole 7-day pull onto its first day — the Sept 13-19 batch landed
  // 411 leads on 09-13, so filtering 09-14…09-19 showed nothing and producers could
  // not work a daily slate. Derived per-lead in SQL so it stays correct on every pull.
  const year = new Date(w.effectiveMin).getUTCFullYear();
  const isRenewal = w.kind === 'renewal';

  // lastSaleDate / effectiveDate are stored as TEXT (YYYY-MM-DD), so the cast is
  // explicit and pattern-guarded — a malformed or missing value falls back to the
  // window start rather than aborting the whole pull. Feb-29 sales clamp to Feb-28 so
  // make_date() can't throw in a non-leap year.
  const res = await pool.query(
    `WITH calc AS (
       SELECT "propertyId",
              COALESCE(
                CASE WHEN "lastSaleDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
                  make_date(
                    $2::int,
                    EXTRACT(MONTH FROM "lastSaleDate"::date)::int,
                    CASE WHEN EXTRACT(MONTH FROM "lastSaleDate"::date)::int = 2
                          AND EXTRACT(DAY   FROM "lastSaleDate"::date)::int > 28
                         THEN 28
                         ELSE EXTRACT(DAY FROM "lastSaleDate"::date)::int END
                  )
                END,
                $3::date
              ) AS eff
         FROM "Lead"
        WHERE "propertyId" = ANY($6)
     )
     UPDATE "Lead" l
        SET "engine" = $1,
            "effectiveDate" = to_char(c.eff, 'YYYY-MM-DD'),
            "renewalTargetDate" = CASE WHEN $4::boolean THEN c.eff - ($5::int) ELSE NULL END,
            "updatedAt" = NOW()
       FROM calc c
      WHERE l."propertyId" = c."propertyId"`,
    [isRenewal ? 2 : 1, year, w.effectiveMin, isRenewal, RENEWAL_PULL_LEAD_DAYS, ids],
  );
  return res.rowCount ?? 0;
}

export interface WindowReport {
  label: string;
  kind: PullWindow['kind'];
  originationMin: string;
  originationMax: string;
  effectiveMin: string;
  effectiveMax: string;
  matched: number;     // candidates found (free scan)
  alreadyHave: number; // already in DB → free
  newPulled: number;   // full data fetched → credits spent
  dated: number;       // matched leads stamped with window effective/x-date → free
}

export interface WeeklyPullResult {
  dryRun: boolean;
  runDate: string;
  windows: WindowReport[];
  totals: {
    matched: number;
    alreadyHave: number;
    creditsSpent: number; // full-data pulls (newPulled) + PropertyDetail credits
    dated: number;
    detailPulled: number;  // new Grade-A SFR leads enriched via PropertyDetail
    detailCredits: number; // credits spent on PropertyDetail (1 per lead)
  };
}

/**
 * Granular PropertyDetail enrichment for the just-pulled NEW Grade-A single-family
 * leads (Frank Aug-2026). One REAPI credit per lead, serial + lightly throttled. These
 * are brand-new leads (never in the DB before this run), so writing PropertyDetail's
 * fields can't clobber any producer entry. Returns attempts (== credits) + writes.
 */
async function enrichGradeAWithDetail(newIds: string[]): Promise<{ attempted: number; detailed: number }> {
  if (!ENRICH_GRADE_A_WITH_DETAIL || !newIds.length) return { attempted: 0, detailed: 0 };
  // Only NEW Grade-A SINGLE-FAMILY (SFR) leads — condos are excluded (Frank: granular
  // data isn't needed for condos, which are the bulk of Grade A).
  const rows = (await sql`
    SELECT "propertyId" FROM "Lead"
    WHERE "propertyId" = ANY(${newIds}) AND "grade" = 'A' AND "propertyType" = 'SFR'
  `) as { propertyId: string }[];

  let detailed = 0;
  for (const { propertyId } of rows) {
    const patch = await fetchPropertyDetailPatch(propertyId); // 1 credit each
    if (patch) { await updateLead(propertyId, patch); detailed++; }
    await new Promise((r) => setTimeout(r, DETAIL_GAP_MS));
  }
  return { attempted: rows.length, detailed };
}

export async function runWeeklyPull(opts?: {
  runDate?: Date;
  dryRun?: boolean;
}): Promise<WeeklyPullResult> {
  const dryRun = opts?.dryRun ?? false;
  const runDate = opts?.runDate ?? new Date();

  if (!API_CONFIG.API_KEY) {
    throw new Error('REAPI key not configured (NEXT_PUBLIC_REAL_ESTATE_API_KEY)');
  }

  const windows = computePullWindows(runDate);
  const reports: WindowReport[] = [];
  const allNewIds = new Set<string>(); // distinct brand-new leads across all windows

  for (const w of windows) {
    const ids = await scanWindowIds(w); // FREE
    const have = new Set(await getExistingPropertyIds(ids));
    const newIds = ids.filter((id) => !have.has(id));
    const existingIds = ids.filter((id) => have.has(id));

    let newPulled = 0;
    let dated = 0;

    if (!dryRun) {
      if (newIds.length) {
        const props = await fetchFullByIds(newIds); // CREDITS — new only
        await upsertLeads(props);
        await enrichLeadBatch(props);
        newPulled = props.length;
        newIds.forEach((id) => allNewIds.add(id));
      }
      // Stamp window effective/x-date on everything matched (new + already-stored). FREE.
      dated = await applyWindowDates(ids, w);
    }

    reports.push({
      label: w.label,
      kind: w.kind,
      originationMin: w.originationMin,
      originationMax: w.originationMax,
      effectiveMin: w.effectiveMin,
      effectiveMax: w.effectiveMax,
      matched: ids.length,
      alreadyHave: existingIds.length,
      newPulled,
      dated,
    });
  }

  // Granular PropertyDetail on the new Grade-A single-family leads (Frank Aug-2026).
  // Runs after all windows so a lead pulled in multiple windows is detailed once.
  const detail = dryRun ? { attempted: 0, detailed: 0 } : await enrichGradeAWithDetail([...allNewIds]);

  return {
    dryRun,
    runDate: runDate.toISOString().slice(0, 10),
    windows: reports,
    totals: {
      matched: reports.reduce((s, r) => s + r.matched, 0),
      alreadyHave: reports.reduce((s, r) => s + r.alreadyHave, 0),
      creditsSpent: reports.reduce((s, r) => s + r.newPulled, 0) + detail.attempted,
      dated: reports.reduce((s, r) => s + r.dated, 0),
      detailPulled: detail.detailed,   // Grade-A SFR leads enriched via PropertyDetail
      detailCredits: detail.attempted, // credits spent on PropertyDetail (1 per lead)
    },
  };
}
