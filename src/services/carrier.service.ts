import { Lead } from '@/types/lead';
import { CarrierRuleResult, CarrierEligibilityResult, EligibilityStatus } from '@/types/carrier';

// ─── Target Zip Codes ────────────────────────────────────────────────────────
//
// BIA focus territory (Jun 2026): leads are only sourced from these ZIP codes.
// No geographic disqualification is applied — carrier eligibility is determined
// solely by property characteristics (roof age, value, flood zone, etc.).
//
export const TARGET_ZIPS = new Set([
  '07722', // Colts Neck
  '07724', // Eatontown
  '07726', // Englishtown / Manalapan
  '07728', // Freehold
  '07730', // Hazlet
  '07731', // Howell
  '07733', // Holmdel
  '07746', // Marlboro
  '07748', // Middletown
  '08701', // Lakewood
]);

// ─── Residential use codes accepted by both carriers ─────────────────────────
const RESIDENTIAL_USES = [
  'Residential',
  'Single Family',
  'SFR',
  'Single Family Residential',
  'Townhouse',
  'Condominium',
  'Cooperative',
  'Duplex',
];

// SFHA (Special Flood Hazard Area) zone prefixes → high-risk flood
const SFHA_ZONE_PREFIXES = ['A', 'V'];

function isResidential(lead: Lead): boolean {
  if (!lead.propertyUse && !lead.propertyType) return false;
  const use = (lead.propertyUse || '').trim();
  const type = (lead.propertyType || '').trim();
  return (
    RESIDENTIAL_USES.some((r) => use.toLowerCase().includes(r.toLowerCase())) ||
    RESIDENTIAL_USES.some((r) => type.toLowerCase().includes(r.toLowerCase()))
  );
}

function isInSFHA(lead: Lead): boolean {
  if (!lead.floodZone) return false;
  if (!lead.floodZoneType) return true; // flood zone present but type unknown → treat as risk
  return SFHA_ZONE_PREFIXES.some((prefix) =>
    lead.floodZoneType!.toUpperCase().startsWith(prefix)
  );
}

function getPropertyAge(lead: Lead): number | null {
  if (!lead.yearBuilt) return null;
  return new Date().getFullYear() - lead.yearBuilt;
}

// ─── TRAVELERS NJ Homeowners ──────────────────────────────────────────────────
//
// Source: Travelers Quantum Home 2.0 Personal Lines Manual
//
// Hard ineligible:
//   - Non-residential property use
//   - Corporate/LLC/Trust owned (standard HO requires individual owner)
//   - Vacant or unoccupied (unless occupied within 30 days)
//   - Flood zones starting with A or V (ineligible unless separate flood policy)
//   - REO / foreclosure / pre-foreclosure
//
// Referral to underwriting (mapped as 'review'):
//   - Coverage A (estimated value) ≥ $1,500,000 — requires monitored alarm + water sensor
//   - Pre-1940 construction — uses different replacement cost methodology
//   - Investor-owned / absentee owner
//   - Prior structural losses at the address
//
// Note: Travelers does NOT have a hard year-built ineligibility cutoff.
//       Pre-1940 homes only require Functional Replacement Cost calculation.

export function checkTravelersEligibility(lead: Lead): CarrierRuleResult {
  const notes: string[] = [];
  let status: EligibilityStatus = 'eligible';

  const makeIneligible = (reason: string) => {
    notes.push(reason);
    status = 'ineligible';
  };

  const makeReview = (reason: string) => {
    notes.push(reason);
    if (status === 'eligible') status = 'review';
  };

  // ── Hard disqualifiers ────────────────────────────────────────────────────

  if (!isResidential(lead)) {
    makeIneligible(`Non-residential property use: "${lead.propertyUse || lead.propertyType}"`);
  }

  if (lead.corporateOwned) {
    makeIneligible('Corporate/LLC-owned — standard HO-3 requires individual owner');
  }

  if (lead.vacant) {
    makeIneligible('Vacant or unoccupied property — ineligible per Travelers guidelines');
  }

  if (lead.preForeclosure || lead.foreclosure) {
    makeIneligible('Property in pre-foreclosure or active foreclosure');
  }

  if (lead.reo) {
    makeIneligible('REO (bank-owned) — not eligible for standard homeowners policy');
  }

  // Flood zones A and V series → ineligible per Quantum Home 2.0
  if (isInSFHA(lead)) {
    makeIneligible(
      `FEMA flood zone ${lead.floodZoneType || '(A/V series)'} — ineligible unless separate NFIP/flood policy in place`
    );
  }

  // ── Referral to underwriting (review) ────────────────────────────────────
  // $1.5M+ requires monitored central station alarm + water sensor to bind
  if (lead.estimatedValue && lead.estimatedValue >= 1_500_000) {
    makeReview(
      `Estimated value $${lead.estimatedValue.toLocaleString()} — Coverage A ≥$1.5M requires monitored alarm system and underwriting approval`
    );
  }

  // Pre-1940 construction uses Functional Replacement Cost — flag for producer awareness
  if (lead.yearBuilt && lead.yearBuilt < 1940) {
    makeReview(
      `Year built ${lead.yearBuilt} — pre-1940 construction requires Functional Replacement Cost endorsement`
    );
  }

  if (lead.investorBuyer) {
    makeReview('Investor-owned — Travelers prefers owner-occupied; referral required');
  }

  if (lead.absenteeOwner && !lead.ownerOccupied) {
    makeReview('Absentee owner — confirm owner-occupancy status before binding');
  }

  if (status === 'eligible' && notes.length === 0) {
    notes.push('Meets all Travelers Quantum Home 2.0 NJ eligibility criteria');
  }

  return { status, notes };
}

// ─── PLYMOUTH ROCK NJ Homeowners ─────────────────────────────────────────────
//
// Source: Plymouth Rock Assurance NJ website + AtHome Insurance Company (NJ entity)
//
// Hard ineligible:
//   - Non-residential property use
//   - Corporate/LLC owned
//   - Vacant or unoccupied
//   - Foreclosure / pre-foreclosure / REO
//   - Homes built more than 100 years ago (website: "homes built more than 100 years ago don't qualify")
//   - SFHA flood zones (A/V series) — same as Travelers
//
// Review:
//   - Homes 75–100 years old (discount tiers: newer = larger discount)
//   - Investor-owned / absentee owner
//   - Estimated value > $2M
//
// Note: Plymouth Rock writes NJ exclusively through AtHome Insurance Company for owners.
//       The 100-year rule is explicitly stated on their NJ product page.

export function checkPlymouthRockEligibility(lead: Lead): CarrierRuleResult {
  const notes: string[] = [];
  let status: EligibilityStatus = 'eligible';

  const makeIneligible = (reason: string) => {
    notes.push(reason);
    status = 'ineligible';
  };

  const makeReview = (reason: string) => {
    notes.push(reason);
    if (status === 'eligible') status = 'review';
  };

  const currentYear = new Date().getFullYear();

  // ── Hard disqualifiers ────────────────────────────────────────────────────

  if (!isResidential(lead)) {
    makeIneligible(`Non-residential property use: "${lead.propertyUse || lead.propertyType}"`);
  }

  if (lead.corporateOwned) {
    makeIneligible('Corporate/LLC-owned — AtHome Insurance requires individual owner');
  }

  if (lead.vacant) {
    makeIneligible('Vacant or unoccupied property — ineligible per Plymouth Rock guidelines');
  }

  if (lead.preForeclosure || lead.foreclosure) {
    makeIneligible('Property in pre-foreclosure or active foreclosure');
  }

  if (lead.reo) {
    makeIneligible('REO (bank-owned) — not eligible');
  }

  // Plymouth Rock explicitly states: homes built more than 100 years ago don't qualify
  if (lead.yearBuilt && (currentYear - lead.yearBuilt) > 100) {
    makeIneligible(
      `Year built ${lead.yearBuilt} — Plymouth Rock does not write homes more than 100 years old (built before ${currentYear - 100})`
    );
  }

  // SFHA flood zones — same hard rule as Travelers
  if (isInSFHA(lead)) {
    makeIneligible(
      `FEMA flood zone ${lead.floodZoneType || '(A/V series)'} — ineligible`
    );
  }

  // ── Referral / review flags ───────────────────────────────────────────────
  // Homes 75–100 years old qualify but receive reduced new-home discounts
  if (lead.yearBuilt && (currentYear - lead.yearBuilt) > 75 && (currentYear - lead.yearBuilt) <= 100) {
    makeReview(
      `Year built ${lead.yearBuilt} — older home (75–100 years); qualifies but no new-home discount applies`
    );
  }

  if (lead.estimatedValue && lead.estimatedValue > 2_000_000) {
    makeReview(
      `Estimated value $${lead.estimatedValue.toLocaleString()} — above $2M standard limit; high-value review required`
    );
  }

  if (lead.investorBuyer) {
    makeReview('Investor-owned — review required');
  }

  if (lead.absenteeOwner && !lead.ownerOccupied) {
    makeReview('Absentee owner — confirm occupancy status');
  }

  if (status === 'eligible' && notes.length === 0) {
    notes.push('Meets all Plymouth Rock (AtHome Insurance) NJ eligibility criteria');
  }

  return { status, notes };
}

// ─── Combined eligibility check ───────────────────────────────────────────────

export function checkCarrierEligibility(lead: Lead): CarrierEligibilityResult {
  const travelers = checkTravelersEligibility(lead);
  const plymouthRock = checkPlymouthRockEligibility(lead);

  const passesAnyCarrier =
    travelers.status !== 'ineligible' || plymouthRock.status !== 'ineligible';

  return { travelers, plymouthRock, passesAnyCarrier };
}

// ─── Helper: best carrier status label ───────────────────────────────────────

export function getBestCarrierStatus(result: CarrierEligibilityResult): EligibilityStatus {
  const statuses = [result.travelers.status, result.plymouthRock.status];
  if (statuses.includes('eligible')) return 'eligible';
  if (statuses.includes('review')) return 'review';
  return 'ineligible';
}
