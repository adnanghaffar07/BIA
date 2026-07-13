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
  appliesWhen?: (lead: any) => boolean;
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
  // quote-ready until a producer confirms roof age on the call and enters it.
  // Frank (Jun-2026, post-demo): roof year is a needed-confirmation field when the
  // home is OLDER THAN 20 YEARS (age = currentYear − yearBuilt > 20). Both Travelers
  // (>20 yr roof out of appetite) and Plymouth (factors roof type/condition) need the
  // roof confirmed on 20+ yr homes, so an unconfirmed roof there drops the lead off A.
  // Homes built 2006+ (≤20 yr) have a roof young enough that it doesn't gate the quote.
  {
    path: 'roofYear', label: 'Roof age / year installed (home >20 yrs)', critical: true,
    appliesWhen: (l) => {
      const yb = Number(l.yearBuilt);
      return !yb || (new Date().getFullYear() - yb) > 20;
    },
  },

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

/**
 * Condo detection (Frank Jul-2026). Travelers & Plymouth Rock do NOT rate condos on
 * home-characteristic fields — roof age, year built, square footage, bedroom count.
 * A condo within carrier appetite is quote-ready on its identity fields alone, so we
 * drop those characteristics from a condo's pertinent-field set → in-appetite condos
 * grade A. Zip / carrier-appetite / flood logic is unchanged.
 */
export function isCondo(lead: any): boolean {
  const pt = String(lead.propertyType ?? '').toUpperCase();
  const lu = String(lead.landUse ?? '').toLowerCase();
  return pt === 'CONDO' || lu.includes('condo');
}
const CONDO_EXEMPT_FIELDS = new Set(['yearBuilt', 'squareFeet', 'roofYear', 'bedrooms']);

/** Critical fields that currently apply to this lead (honors per-field appliesWhen + condo exemptions). */
function activeFields(lead: any) {
  const condo = isCondo(lead);
  return CRITICAL_FIELDS.filter((f) => {
    if (f.appliesWhen && !f.appliesWhen(lead)) return false;
    if (condo && CONDO_EXEMPT_FIELDS.has(f.path)) return false;
    return true;
  });
}

/**
 * Flood-zone grade cap (Frank, Jun-2026):
 *   • SFHA "blue" zones (A/AE/AH/AO/AR, V/VE) → 'D' (also enforced as a carrier FAIL)
 *   • Moderate-risk SHADED Zone X ("orange", 0.2% annual chance) → cap at 'C'
 *   • Unshaded/minimal Zone X (most inland NJ) → no cap (returns null)
 * Returns the worst grade this lead may hold from flood alone, or null.
 */
function floodZoneGradeCap(lead: any): LeadGrade | null {
  // Authoritative FEMA flag first (SFHA_TF from the NFHL lookup).
  if (lead.floodSfha === true) return 'D';
  const z = String(lead.floodZoneType ?? '').trim().toUpperCase();
  const sub = String(lead.floodZoneSubtype ?? '').toUpperCase();
  if (/^(A|V)/.test(z)) return 'D';                                  // SFHA zones (fallback by prefix)
  if (z === 'X' && /0\.2\s*PCT/.test(sub)) return 'C';              // shaded/moderate X (FEMA subtype)
  if (z === 'X500' || z.includes('0.2') || sub.includes('SHADED')) return 'C';
  if (lead.floodZone === true && z === 'X') return 'C';            // legacy heuristic
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

  // Flood cap: high-risk SFHA → hard D regardless of anything else.
  const floodCap = floodZoneGradeCap(lead);
  if (floodCap === 'D') return 'D';

  // D — no carrier will write this property
  if (!carrierResult.passesAnyCarrier) return 'D';

  // Contactability (Frank Jul-2026): once a lead has been skip-traced, if we STILL
  // have no phone AND no email, it's unworkable → D. Only applies post-skip-trace
  // (contact info comes FROM the trace); DOB is an estimate and is not required.
  const l = lead as any;
  if (l.skipTraced && !l.phone1 && !l.phone2 && !l.email1 && !l.email2) return 'D';

  // Count missing pertinent fields (only those that apply to this lead)
  const missingCount = activeFields(lead).filter(
    ({ path, altPath }) => !getValue(lead, path, altPath)
  ).length;

  let grade: LeadGrade =
    missingCount === 0 ? 'A' // Quote-Ready — all fields present
      : missingCount === 1 ? 'B' // Minor — exactly 1 field missing
        : 'C';                   // Needs information — 2+ fields missing

  // Moderate flood (shaded Zone X) caps the grade at C even if otherwise quote-ready.
  if (floodCap === 'C' && (grade === 'A' || grade === 'B')) grade = 'C';

  return grade;
}

/**
 * Get the list of missing field labels for a lead.
 */
export function getMissingFields(lead: Lead): string[] {
  return activeFields(lead)
    .filter(({ path, altPath }) => !getValue(lead, path, altPath))
    .map(({ label }) => label);
}

/**
 * Get the list of missing CRITICAL (non-recoverable) field labels.
 */
export function getMissingCriticalFields(lead: Lead): string[] {
  return activeFields(lead)
    .filter(({ path, altPath, critical }) => critical && !getValue(lead, path, altPath))
    .map(({ label }) => label);
}

/**
 * Get the percentage of pertinent fields that are complete.
 */
export function getCompletenessPercentage(lead: Lead): number {
  const fields = activeFields(lead);
  const total = fields.length;
  const missing = fields.filter(
    ({ path, altPath }) => !getValue(lead, path, altPath)
  ).length;
  return total === 0 ? 100 : Math.round(((total - missing) / total) * 100);
}

/**
 * Whether a lead can have skip trace run on it.
 * Frank (Jun-2026, post-demo): enabled for ALL workable grades (A, B, C) so the team
 * can enrich data and potentially upgrade a lead — not just carrier-qualified ones.
 * Only Grade D (out of appetite) and already-traced leads are blocked.
 */
export function canRunSkipTrace(lead: Lead, _eligibility?: CarrierEligibilityResult): boolean {
  if ((lead as any).skipTraced) return false;
  const grade = (lead as any).manualGrade || (lead as any).grade;
  return grade === 'A' || grade === 'B' || grade === 'C';
}
