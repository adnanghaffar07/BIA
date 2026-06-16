import { Lead } from '@/types/lead';
import { LeadGrade } from '@/types/grade';
import { CarrierEligibilityResult } from '@/types/carrier';
import { checkCarrierEligibility } from './carrier.service';

// ─── Critical fields ──────────────────────────────────────────────────────────
//
// These are the fields a producer MUST have to open a carrier portal and generate
// a quote. Missing any of these = the lead cannot be quoted without intervention.
//
// Each entry has:
//   path       — field name on the lead object (supports dot-notation for nested)
//   altPath    — flat DB field name (leads from Neon come back with flat column names)
//   label      — human-readable name shown in the UI
//   critical   — true = 1 missing field drops to Grade C; false = Grade B

const CRITICAL_FIELDS: Array<{
  path: string;
  altPath?: string;
  label: string;
  critical: boolean;
}> = [
  // ── Property identification ──────────────────────────────────────────────
  { path: 'owner1LastName',   label: 'Owner last name',    critical: true  },
  { path: 'address.street',   altPath: 'addressStreet',    label: 'Street address',   critical: true  },
  { path: 'address.zip',      altPath: 'addressZip',       label: 'ZIP code',         critical: true  },
  { path: 'address.city',     altPath: 'addressCity',      label: 'City',             critical: false },

  // ── Property data needed to quote ────────────────────────────────────────
  { path: 'estimatedValue',   label: 'Estimated property value',   critical: true  },
  { path: 'yearBuilt',        label: 'Year built (age of home)',    critical: true  },
  { path: 'squareFeet',       label: 'Square footage (for RCE)',    critical: true  },

  // ── Roof age — the single biggest NJ knockout/rating driver ───────────────
  // Spec §4B/§6: an estimated (vs confirmed) roof age means the lead is NOT
  // quote-ready. Until the roof-data vendor lands (Open Item 7.5), roofYear is
  // empty on every lead, so leads sit at "Needs-Info" (B/C) until a producer
  // confirms roof age on the call and enters it — or manually upgrades the grade.
  { path: 'roofYear',         label: 'Roof age / year installed',  critical: true  },

  // ── Useful but can be answered at the portal ──────────────────────────────
  { path: 'propertyType',     label: 'Property type',     critical: false },
  { path: 'bedrooms',         label: 'Bedrooms',          critical: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a field from a lead — tries the primary path first, then the flat altPath.
 * Handles both nested API objects (address.zip) and flat DB records (addressZip).
 */
function getValue(lead: any, path: string, altPath?: string): any {
  const nested = path.split('.').reduce((cur: any, key: string) => cur?.[key], lead);
  if (nested != null && nested !== '') return nested;
  if (altPath) {
    const flat = lead[altPath];
    if (flat != null && flat !== '') return flat;
  }
  return null;
}

// ─── Public exports ───────────────────────────────────────────────────────────

/**
 * Calculate the carrier-aware lead grade per BIA Blueprint:
 *
 *   D — Fails ALL carrier appetite rules (geographic or underwriting)
 *   C — Passes ≥1 carrier but has 2+ missing pertinent fields
 *   B — Passes ≥1 carrier but has exactly 1 missing pertinent field
 *   A — Passes ≥1 carrier AND all pertinent fields present (Quote-Ready)
 *
 * Pre-computed eligibility can be passed in to avoid double-evaluation.
 */
export function calculateLeadGrade(
  lead: Lead,
  eligibility?: CarrierEligibilityResult
): LeadGrade {
  if (!lead || !(lead.propertyId || (lead as any).propertyId)) return 'D';

  const carrierResult = eligibility ?? checkCarrierEligibility(lead);

  // D — no carrier will write this property
  if (!carrierResult.passesAnyCarrier) return 'D';

  // Count missing pertinent fields
  const missingCount = CRITICAL_FIELDS.filter(
    ({ path, altPath }) => !getValue(lead, path, altPath)
  ).length;

  if (missingCount === 0) return 'A'; // Quote-Ready — all fields present
  if (missingCount === 1) return 'B'; // Minor — exactly 1 field missing
  return 'C';                          // Needs information — 2+ fields missing
}

/**
 * Get the list of missing field labels for a lead.
 */
export function getMissingFields(lead: Lead): string[] {
  return CRITICAL_FIELDS
    .filter(({ path, altPath }) => !getValue(lead, path, altPath))
    .map(({ label }) => label);
}

/**
 * Get the list of missing CRITICAL (non-recoverable) field labels.
 */
export function getMissingCriticalFields(lead: Lead): string[] {
  return CRITICAL_FIELDS
    .filter(({ path, altPath, critical }) => critical && !getValue(lead, path, altPath))
    .map(({ label }) => label);
}

/**
 * Get the percentage of pertinent fields that are complete.
 */
export function getCompletenessPercentage(lead: Lead): number {
  const total = CRITICAL_FIELDS.length;
  const missing = CRITICAL_FIELDS.filter(
    ({ path, altPath }) => !getValue(lead, path, altPath)
  ).length;
  return Math.round(((total - missing) / total) * 100);
}

/**
 * Whether a lead can have skip trace run on it.
 * Skip trace is gated: only run on leads that pass at least one carrier.
 */
export function canRunSkipTrace(lead: Lead, eligibility?: CarrierEligibilityResult): boolean {
  if ((lead as any).skipTraced) return false;
  const result = eligibility ?? checkCarrierEligibility(lead);
  return result.passesAnyCarrier;
}
