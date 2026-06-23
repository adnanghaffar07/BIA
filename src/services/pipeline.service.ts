import { Lead, PipelineEngine } from '@/types/lead';

const ENGINE1_DAYS = 90; // New Purchase: policy effective ~90 days after mortgage origination
const ENGINE2_START = new Date('2022-01-01');
const ENGINE2_END = new Date('2025-12-31');
const RENEWAL_LEAD_DAYS = 60; // Frank Jun-2026: work renewals 60 days before anniversary (was 90)

/**
 * Determine which pipeline engine a lead belongs to based on mortgage/sale date.
 *
 * Engine 1 — New Purchase: sale/recording date within the last 90 days.
 *            These homeowners are actively shopping for insurance.
 *
 * Engine 2 — Renewal / Win-Back: sale date between 2022 and 2025.
 *            Target ~90 days before their policy anniversary.
 */
export function assignPipelineEngine(lead: any): PipelineEngine | null {
  // Prefer the first mortgage recording date from currentMortgages if available
  const mortgageDate = lead.currentMortgages?.[0]?.recordingDate;
  const dateStr = mortgageDate || lead.lastSaleDate || lead.recordingDate;
  if (!dateStr) return null;

  const saleDate = new Date(dateStr);
  if (isNaN(saleDate.getTime())) return null;

  const now = new Date();
  const daysSinceSale = Math.floor(
    (now.getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceSale <= ENGINE1_DAYS) {
    return 1;
  }

  if (saleDate >= ENGINE2_START && saleDate <= ENGINE2_END) {
    return 2;
  }

  return null;
}

/**
 * Project an Engine 2 lead's next policy anniversary (the renewal EFFECTIVE date).
 * A policy renews on the same calendar day it originated, so the anniversary is the
 * origination month/day in the current year — or next year if it has already passed.
 */
export function getRenewalAnniversary(lead: any): Date | null {
  const mortgageDate = lead.currentMortgages?.[0]?.recordingDate;
  const dateStr = mortgageDate || lead.lastSaleDate || lead.recordingDate;
  if (!dateStr) return null;

  const saleDate = new Date(dateStr);
  if (isNaN(saleDate.getTime())) return null;

  const now = new Date();
  const anniversary = new Date(saleDate);
  anniversary.setFullYear(now.getFullYear());

  // If this year's anniversary has already passed, use next year
  if (anniversary <= now) {
    anniversary.setFullYear(now.getFullYear() + 1);
  }

  return anniversary;
}

/**
 * Calculate the renewal CONTACT date (x-date) for Engine 2 leads.
 * Returns the next policy anniversary minus RENEWAL_LEAD_DAYS (60) — i.e. when the
 * producer should start working the renewal.
 */
export function getRenewalTargetDate(lead: any): Date | null {
  const anniversary = getRenewalAnniversary(lead);
  if (!anniversary) return null;

  const targetDate = new Date(anniversary);
  targetDate.setDate(targetDate.getDate() - RENEWAL_LEAD_DAYS);

  return targetDate;
}

/**
 * Effective date = the policy's actual effective/renewal date (Frank Jun-2026):
 *   Engine 1 (New Purchase): origination/sale date + 90 days.
 *   Engine 2 (Renewal):      the policy anniversary (origination month/day, this/next year).
 * (The renewal CONTACT date — anniversary − 60 — is getRenewalTargetDate.)
 */
export function getEffectiveDate(lead: any): Date | null {
  const engine = lead.engine ?? assignPipelineEngine(lead);
  if (engine === 2) return getRenewalAnniversary(lead);
  if (engine !== 1) return null; // unassigned/old leads have no actionable triage date

  const dateStr = lead.currentMortgages?.[0]?.recordingDate || lead.lastSaleDate || lead.recordingDate;
  if (!dateStr) return null;
  const base = new Date(dateStr);
  if (isNaN(base.getTime())) return null;
  const eff = new Date(base);
  eff.setDate(eff.getDate() + ENGINE1_DAYS);
  return eff;
}

/**
 * Check if an Engine 2 lead is in its active renewal window
 * (i.e., today is on or after the target contact date).
 */
export function isInRenewalWindow(lead: Lead): boolean {
  if (lead.engine !== 2 || !lead.renewalTargetDate) return false;
  return new Date() >= new Date(lead.renewalTargetDate);
}

/**
 * Get a human-readable engine label.
 */
export function getEngineLabel(engine: PipelineEngine | null | undefined): string {
  if (engine === 1) return 'New Purchase';
  if (engine === 2) return 'Renewal / Win-Back';
  return 'Unassigned';
}

/**
 * Get days since last sale date.
 */
export function getDaysSinceSale(lead: Lead): number | null {
  const dateStr = lead.lastSaleDate || lead.recordingDate;
  if (!dateStr) return null;
  const saleDate = new Date(dateStr);
  if (isNaN(saleDate.getTime())) return null;
  return Math.floor(
    (new Date().getTime() - saleDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

// ─── Weekly REAPI pull windows (Frank Jun-2026) ────────────────────────────────
//
// Each weekly pull grabs a rolling 7-day slice, filtered on the mortgage
// origination (first-mortgage recording) date:
//
//   New biz : policy is effective ~90 days after origination, so to catch policies
//             effective THIS week we pull origination = this-week − 90 days.
//   Renewal : a policy renews on its anniversary. We work renewals 60 days early,
//             so the anniversaries we want are this-week + 60 days; the matching
//             origination dates are that same month/day in each prior year
//             (1–4 years back → 2022–2025 for a 2026 anniversary).
//
// The slice is anchored at the run date (the 7 days starting that day). Run the
// pull weekly for contiguous, non-overlapping coverage. Re-runs are safe — the
// two-phase ids_only de-dup means already-pulled records cost no credits.

export const PULL_WINDOW_DAYS = 7;
export const NEW_BIZ_LEAD_DAYS = ENGINE1_DAYS;        // 90
export const RENEWAL_PULL_LEAD_DAYS = RENEWAL_LEAD_DAYS; // 60
export const RENEWAL_ORIGINATION_YEARS_BACK = [1, 2, 3, 4]; // 2025,2024,2023,2022 for a 2026 anniversary

export interface PullWindow {
  kind: 'new_biz' | 'renewal';
  label: string;
  /** Inclusive origination-date filter sent to REAPI (first_mortgage_recording_date_min/max) */
  originationMin: string; // YYYY-MM-DD
  originationMax: string; // YYYY-MM-DD
  /** The policy effective/anniversary window these map to */
  effectiveMin: string;
  effectiveMax: string;
  /** For renewals only — the origination year this window targets */
  originationYear?: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
// UTC-consistent so REAPI date filters don't shift by a day in non-UTC timezones.
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Compute this run's weekly pull windows (1 new-biz + 4 renewal years).
 * Pass an explicit runDate to reproduce a past/future week (defaults to today).
 */
export function computePullWindows(runDate: Date = new Date()): PullWindow[] {
  const weekStart = new Date(ymd(runDate)); // normalize to midnight UTC
  const weekEnd = addDays(weekStart, PULL_WINDOW_DAYS - 1);
  const windows: PullWindow[] = [];

  // New biz — effective = this week; origination = effective − 90 days
  windows.push({
    kind: 'new_biz',
    label: 'New biz',
    originationMin: ymd(addDays(weekStart, -NEW_BIZ_LEAD_DAYS)),
    originationMax: ymd(addDays(weekEnd, -NEW_BIZ_LEAD_DAYS)),
    effectiveMin: ymd(weekStart),
    effectiveMax: ymd(weekEnd),
  });

  // Renewal — anniversary = this week + 60 days; origination = same month/day, prior years
  const annivStart = addDays(weekStart, RENEWAL_PULL_LEAD_DAYS);
  const annivEnd = addDays(weekEnd, RENEWAL_PULL_LEAD_DAYS);
  const effYear = annivStart.getUTCFullYear();
  for (const back of RENEWAL_ORIGINATION_YEARS_BACK) {
    const year = effYear - back;
    const oMin = new Date(annivStart); oMin.setUTCFullYear(year);
    const oMax = new Date(annivEnd); oMax.setUTCFullYear(year);
    windows.push({
      kind: 'renewal',
      label: `Renewal ${year}`,
      originationMin: ymd(oMin),
      originationMax: ymd(oMax),
      effectiveMin: ymd(annivStart),
      effectiveMax: ymd(annivEnd),
      originationYear: year,
    });
  }

  return windows;
}
