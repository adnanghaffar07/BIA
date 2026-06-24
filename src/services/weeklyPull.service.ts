import { API_CONFIG } from '@/lib/constants';
import { pool } from '@/lib/neon';
import {
  computePullWindows,
  RENEWAL_PULL_LEAD_DAYS,
  PullWindow,
} from './pipeline.service';
import { upsertLeads, getExistingPropertyIds } from './storage.service';
import { enrichLeadBatch } from './enrichment.service';

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

// BIA target ZIPs + permanent appetite filters (mirrors api/leads + seed)
const TARGET_ZIPS = ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'];
const BASE_FILTERS = {
  state: 'NJ',
  zip: TARGET_ZIPS,
  flood_zone: false,
  vacant: false,
  pre_foreclosure: false,
  foreclosure: false,
  reo: false,
} as const;

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
  const effective = w.effectiveMin; // window start (earliest anniversary in the slice)
  const xDate =
    w.kind === 'renewal'
      ? new Date(new Date(effective).getTime() - RENEWAL_PULL_LEAD_DAYS * 86400000).toISOString()
      : null;
  const res = await pool.query(
    `UPDATE "Lead"
       SET "engine" = $1, "effectiveDate" = $2, "renewalTargetDate" = $3, "updatedAt" = NOW()
     WHERE "propertyId" = ANY($4)`,
    [w.kind === 'renewal' ? 2 : 1, effective, xDate, ids],
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
    creditsSpent: number; // == sum(newPulled)
    dated: number;
  };
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

  return {
    dryRun,
    runDate: runDate.toISOString().slice(0, 10),
    windows: reports,
    totals: {
      matched: reports.reduce((s, r) => s + r.matched, 0),
      alreadyHave: reports.reduce((s, r) => s + r.alreadyHave, 0),
      creditsSpent: reports.reduce((s, r) => s + r.newPulled, 0),
      dated: reports.reduce((s, r) => s + r.dated, 0),
    },
  };
}
