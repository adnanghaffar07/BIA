import { Lead, PipelineEngine } from '@/types/lead';

const ENGINE1_DAYS = 90; // New Purchase: mortgage within last 90 days
const ENGINE2_START = new Date('2022-01-01');
const ENGINE2_END = new Date('2025-12-31');
const RENEWAL_LEAD_DAYS = 90; // Contact 90 days before policy anniversary

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
 * Calculate the renewal target date for Engine 2 leads.
 * Returns the next policy anniversary minus RENEWAL_LEAD_DAYS.
 */
export function getRenewalTargetDate(lead: any): Date | null {
  const mortgageDate = lead.currentMortgages?.[0]?.recordingDate;
  if (!mortgageDate && !lead.lastSaleDate && !lead.recordingDate) return null;

  const dateStr = mortgageDate || lead.lastSaleDate || lead.recordingDate!
  const saleDate = new Date(dateStr);
  if (isNaN(saleDate.getTime())) return null;

  const now = new Date();
  const currentYear = now.getFullYear();

  // Project the anniversary to the current or next year
  const anniversary = new Date(saleDate);
  anniversary.setFullYear(currentYear);

  // If this year's anniversary has already passed, use next year
  if (anniversary <= now) {
    anniversary.setFullYear(currentYear + 1);
  }

  // Target contact date = anniversary minus 90 days
  const targetDate = new Date(anniversary);
  targetDate.setDate(targetDate.getDate() - RENEWAL_LEAD_DAYS);

  return targetDate;
}

/**
 * Effective date for triage (Frank Phase 5):
 *   Engine 1 (New Purchase): origination/sale date + 90 days.
 *   Engine 2 (Renewal): the renewal target date (policy anniversary − 90 days).
 */
export function getEffectiveDate(lead: any): Date | null {
  const engine = lead.engine ?? assignPipelineEngine(lead);
  if (engine === 2) return getRenewalTargetDate(lead);
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
