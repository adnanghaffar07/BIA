import { Lead } from '@/types/lead';
import {
  CarrierRuleResult, CarrierEligibilityResult, EligibilityStatus, Verdict, RuleHit,
  statusFromVerdict,
} from '@/types/carrier';
import { getCoastalAppetite } from './coastDistance.service';

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

// High-risk roof coverings differ by carrier:
//   Plymouth Rock (AtHome guide):   flat-metal, tile, wood
//   Travelers (Quantum 2.0 §II.W):  asbestos, T-lock, Atlas Chalet, wood shakes/shingles, rolled asphalt, overlay
const PR_HIGH_RISK_ROOF = ['flat metal', 'tile', 'wood shake', 'wood shingle', 'wood'];
const TRAVELERS_HIGH_RISK_ROOF = ['asbestos', 't-lock', 'tlock', 'atlas chalet', 'wood shake', 'wood shingle', 'rolled asphalt', 'overlay'];
// "Lifetime" roofs are exempt from the Travelers 20-year roof rule (§II.Y).
const LIFETIME_ROOF = ['tile', 'slate'];

// ─── Predicate helpers ─────────────────────────────────────────────────────────

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

// > 2 family (3–4 unit) dwellings are hard-dropped per BIA sourcing policy
// (Frank, Jun 2026): "hard drop 3–4 family, only source 2 family."
// unitsCount is only a knockout when explicitly > 2 — a missing/unknown unit
// count is NOT penalized (defaults to assuming 1-family).
function exceedsTwoFamily(lead: Lead): boolean {
  return typeof lead.unitsCount === 'number' && lead.unitsCount > 2;
}

function isMultiFamily(lead: Lead): boolean {
  return typeof lead.unitsCount === 'number' && lead.unitsCount >= 2;
}

// Read the property ZIP from either the nested API shape or the flat DB record.
function getLeadZip(lead: Lead): string | null {
  const anyLead = lead as any;
  return anyLead.address?.zip ?? anyLead.addressZip ?? anyLead.zip ?? null;
}

// Shared coastal / hurricane appetite (same rule for both carriers per Frank, Jun 2026).
function coastalFor(lead: Lead) {
  return getCoastalAppetite(getLeadZip(lead), lead.latitude, lead.longitude);
}

// Roof covering, defaulting to 'Unknown' when we have no data (Frank, Jun 2026:
// "if we do not have roof-type for now then set it as Unknown"). 'Unknown' is NOT
// a knockout — only an explicitly high-risk covering is ineligible.
function getRoofType(lead: Lead): string {
  const t = (lead.roofType || '').trim();
  return t === '' ? 'Unknown' : t;
}

// Does the (known) roof covering match any of the given keywords? 'Unknown' never matches.
function roofMatches(lead: Lead, terms: string[]): boolean {
  const t = getRoofType(lead).toLowerCase();
  if (t === 'unknown') return false;
  return terms.some((r) => t.includes(r));
}

// Roof not replaced within the past 20 years (Travelers §II.Y), excluding lifetime
// (tile/slate) materials. Only fires when roofYear is known — an unknown roof age is
// left to the grade "needs-info" gate, not a hard drop.
function roofOlderThan20(lead: Lead): boolean {
  if (!lead.roofYear) return false;
  if (roofMatches(lead, LIFETIME_ROOF)) return false;
  return (new Date().getFullYear() - lead.roofYear) > 20;
}

const money = (n: number) => `$${n.toLocaleString()}`;

// Leads reach this engine in TWO shapes and rules must fire for both:
//   • flat DB rows      (addressZip, addressStreet, mailStreet)  — re-enrichment
//   • raw REAPI records (address.zip, address.street, mailAddress.street) — fresh pulls
// Reading only one shape makes a rule silently dead on the other path.
const propZip = (l: any) => String(l.addressZip ?? l.address?.zip ?? '').trim();
const propStreetOf = (l: any) => String(l.addressStreet ?? l.address?.street ?? '').trim().toLowerCase();
const mailStreetOf = (l: any) => String(l.mailStreet ?? l.mailAddress?.street ?? '').trim().toLowerCase();
const mailCityOf = (l: any) => String(l.mailCity ?? l.mailAddress?.city ?? '').trim();

// The owner's mail goes somewhere other than the property → they don't live there.
// This is the real signal behind REAPI's investorBuyer flag (Frank Jul-2026): it
// reflects OCCUPANCY, not corporate/LLC ownership.
function mailsElsewhere(lead: any): boolean {
  const mail = mailStreetOf(lead);
  const prop = propStreetOf(lead);
  return !!mail && !!prop && mail !== prop;
}

/**
 * Genuinely not owner-occupied. REAPI sometimes contradicts itself — flagging a lead
 * investorBuyer/absenteeOwner while ALSO reporting owner-occupied with the mailing
 * address AT the property (e.g. Anurag Chadha, 562 Clubhouse Dr). Those are data
 * noise, not investors, so we require corroboration before referring the risk.
 */
function notOwnerOccupied(lead: any): boolean {
  if (lead.ownerOccupied === false) return true;
  return mailsElsewhere(lead);
}

// ─── Appetite rules (rules-as-data) ─────────────────────────────────────────────
//
// Each rule carries a structured reason code + severity. The engine evaluates every
// rule for the relevant carrier and derives the verdict: FAIL if any FAIL trips,
// else REFER if any REFER trips, else PASS. Adding/adjusting a rule is a data edit
// here — no engine changes needed.
//
//   carrier: 'both' applies to Travelers AND Plymouth Rock; otherwise carrier-specific.
//   message: receives the carrier so shared rules can carry carrier-specific wording.

type RuleCarrier = 'travelers' | 'plymouth' | 'both';

interface AppetiteRule {
  code: string;
  carrier: RuleCarrier;
  severity: 'FAIL' | 'REFER';
  /** true ⇒ the rule trips (lead violates it). */
  applies: (lead: Lead) => boolean;
  message: (lead: Lead, carrier: 'travelers' | 'plymouth') => string;
}

// ─── Carrier appetite by ZIP (observed, not derived) ─────────────────────────
//
// Some carrier behaviour cannot be derived from ANY dataset. The clearest example
// is Travelers throttling Howell 07731 for underwriting CAPACITY — an internal
// aggregation limit inside their book. It is not public data.
//
// We tested the standing theory that it was "adjacent flood zone exposure" against
// the FEMA NFHL layer (Jul-2026) and it does not hold: ~90% of the whole book sits
// within 1 km of an A/AE zone (Howell 75%, Middletown 100%, Marlboro 100%), so
// proximity cannot discriminate anything. The only reliable source is Frank/Ruben's
// observed portal behaviour, recorded here.
//
// TO ADD A ZIP: one line below. No engine changes.
//   severity 'REFER' → underwriting referral   |   'FAIL' → decline / non-eligible
export interface ZipAppetiteEntry {
  zip: string;
  carrier: 'travelers' | 'plymouth';
  severity: 'FAIL' | 'REFER';
  /** Shown on the lead + in QC reports — say WHY, in the carrier's own terms. */
  reason: string;
  /** When Frank/Ruben confirmed this from the portal. */
  observedOn?: string;
}

export const ZIP_APPETITE: ZipAppetiteEntry[] = [
  // Awaiting Frank's confirmed list. Candidates he has flagged verbally but NOT yet
  // confirmed (left inactive on purpose — activating on a hunch would mis-grade the
  // book, and he explicitly asked to review appetite before we hard-code it):
  //
  // { zip: '07731', carrier: 'travelers', severity: 'REFER', reason: 'Underwriting capacity — Travelers throttling this territory', observedOn: '2026-07-10' },
  // { zip: '07724', carrier: 'travelers', severity: 'FAIL',  reason: 'Out of appetite for this ZIP', observedOn: '2026-07-10' },
];

/** ZIP appetite entries compiled into engine rules. */
const zipAppetiteRules: AppetiteRule[] = ZIP_APPETITE.map((e) => ({
  code: `ZIP-${e.carrier.toUpperCase()}-${e.zip}-${e.severity}`,
  carrier: e.carrier,
  severity: e.severity,
  applies: (l: any) => propZip(l) === e.zip,
  message: () => `${e.reason} (ZIP ${e.zip})`,
}));

export const APPETITE_RULES: AppetiteRule[] = [
  // ── Shared hard disqualifiers (FAIL) ──────────────────────────────────────
  {
    code: 'USE-NONRES', carrier: 'both', severity: 'FAIL',
    applies: (l) => !isResidential(l),
    message: (l) => `Non-residential property use: "${l.propertyUse || l.propertyType}"`,
  },
  {
    code: 'UNITS-GT2', carrier: 'both', severity: 'FAIL',
    applies: exceedsTwoFamily,
    message: (l) => `${l.unitsCount}-unit dwelling — BIA sources owner-occupied 1–2 family only; 3–4 family hard-dropped`,
  },
  {
    code: 'OWNER-ENTITY', carrier: 'both', severity: 'FAIL',
    applies: (l) => !!l.corporateOwned,
    message: (_l, c) => c === 'travelers'
      ? 'Corporate/LLC-owned — standard HO-3 requires individual owner'
      : 'Corporate/LLC-owned — AtHome Insurance requires individual owner',
  },
  {
    code: 'VACANT', carrier: 'both', severity: 'FAIL',
    applies: (l) => !!l.vacant,
    message: (_l, c) => c === 'travelers'
      ? 'Vacant or unoccupied property — ineligible per Travelers guidelines'
      : 'Vacant or unoccupied property — ineligible per Plymouth Rock guidelines',
  },
  {
    code: 'FORECLOSURE', carrier: 'both', severity: 'FAIL',
    applies: (l) => !!(l.preForeclosure || l.foreclosure),
    message: () => 'Property in pre-foreclosure or active foreclosure',
  },
  {
    code: 'REO', carrier: 'both', severity: 'FAIL',
    applies: (l) => !!l.reo,
    message: (_l, c) => c === 'travelers'
      ? 'REO (bank-owned) — not eligible for standard homeowners policy'
      : 'REO (bank-owned) — not eligible',
  },
  {
    code: 'FLOOD-AV', carrier: 'both', severity: 'FAIL',
    applies: isInSFHA,
    message: (l, c) => c === 'travelers'
      ? `FEMA flood zone ${l.floodZoneType || '(A/V series)'} — ineligible unless separate NFIP/flood policy in place`
      : `FEMA flood zone ${l.floodZoneType || '(A/V series)'} — ineligible`,
  },
  {
    code: 'COAST', carrier: 'both', severity: 'FAIL',
    applies: (l) => !coastalFor(l).eligible,
    message: (l) => coastalFor(l).reason ?? 'Within an ineligible coastal band',
  },

  // ── Travelers-specific hard disqualifiers (FAIL) ──────────────────────────
  {
    code: 'TR-II-W', carrier: 'travelers', severity: 'FAIL',
    applies: (l) => roofMatches(l, TRAVELERS_HIGH_RISK_ROOF),
    message: (l) => `Roof covering "${getRoofType(l)}" — ineligible per Quantum Home 2.0 §II.W`,
  },
  {
    code: 'TR-II-Y', carrier: 'travelers', severity: 'FAIL',
    applies: roofOlderThan20,
    message: (l) => `Roof last replaced ${l.roofYear} (>20 yrs old) — ineligible per Quantum Home 2.0 §II.Y`,
  },

  // ── Plymouth Rock-specific hard disqualifiers (FAIL) ──────────────────────
  {
    code: 'PR-AGE-SFD', carrier: 'plymouth', severity: 'FAIL',
    applies: (l) => !!l.yearBuilt && !isMultiFamily(l) && l.yearBuilt < 1870,
    message: (l) => `Year built ${l.yearBuilt} — single-family dwellings built before 1870 are ineligible`,
  },
  {
    code: 'PR-AGE-MF', carrier: 'plymouth', severity: 'FAIL',
    applies: (l) => !!l.yearBuilt && isMultiFamily(l) && l.yearBuilt < 1900,
    message: (l) => `Year built ${l.yearBuilt} — multi-family dwellings built before 1900 are ineligible`,
  },
  {
    code: 'PR-OWNER-OCC', carrier: 'plymouth', severity: 'FAIL',
    applies: (l) => l.ownerOccupied === false,
    message: () => 'Primary home not owner-occupied — ineligible per Plymouth Rock (AtHome) guidelines',
  },
  {
    code: 'PR-ROOF', carrier: 'plymouth', severity: 'FAIL',
    applies: (l) => roofMatches(l, PR_HIGH_RISK_ROOF),
    message: (l) => `High-risk roof type "${getRoofType(l)}" — flat-metal, tile, and wood roofs are ineligible`,
  },
  {
    code: 'PR-COVA-MAX', carrier: 'plymouth', severity: 'FAIL',
    applies: (l) => !!l.estimatedValue && l.estimatedValue > 2_500_000,
    message: (l) => `Estimated value ${money(l.estimatedValue!)} — exceeds HO-3 maximum Coverage A of $2,500,000`,
  },

  // ── Referral to underwriting (REFER) ──────────────────────────────────────
  {
    code: 'TR-II-M', carrier: 'travelers', severity: 'REFER',
    applies: (l) => !!l.estimatedValue && l.estimatedValue >= 1_500_000,
    message: (l) => `Estimated value ${money(l.estimatedValue!)} — Coverage A ≥$1.5M requires monitored alarm system and underwriting approval`,
  },
  {
    code: 'TR-I-C', carrier: 'travelers', severity: 'REFER',
    applies: (l) => !!l.yearBuilt && l.yearBuilt < 1940,
    message: (l) => `Year built ${l.yearBuilt} — pre-1940 construction requires Functional Replacement Cost endorsement`,
  },
  {
    // Only fires when the data corroborates non-owner-occupancy — never on REAPI's
    // flag alone (which produced false positives on owner-occupied homes).
    code: 'INVESTOR', carrier: 'both', severity: 'REFER',
    applies: (l) => !!l.investorBuyer && notOwnerOccupied(l),
    // Wording states the EVIDENCE, not a conclusion. A different mailing address is a
    // strong hint but not proof — trusts/LLCs mail to a trustee or attorney while the
    // family lives in the home, and PO boxes / forwarded mail look identical. This is a
    // REFER precisely so a producer confirms occupancy rather than us asserting it.
    message: (l, c) => {
      const city = mailCityOf(l);
      const where = city ? ` — owner's mail goes to ${city}` : '';
      return c === 'travelers'
        ? `Possible non-owner-occupied${where}; Travelers prefers owner-occupied — confirm occupancy (referral)`
        : `Possible non-owner-occupied${where} — confirm occupancy (review)`;
    },
  },
  {
    // Same underlying signal as INVESTOR — only fires when INVESTOR hasn't already,
    // so a lead never carries two referrals for one occupancy issue.
    code: 'ABSENTEE', carrier: 'both', severity: 'REFER',
    applies: (l) => !!l.absenteeOwner && !l.ownerOccupied && !(!!l.investorBuyer && notOwnerOccupied(l)),
    message: (_l, c) => c === 'travelers'
      ? 'Absentee owner — confirm owner-occupancy status before binding'
      : 'Absentee owner — confirm occupancy status',
  },

  // ── Observed carrier appetite by ZIP (see ZIP_APPETITE above) ─────────────
  ...zipAppetiteRules,
];

// Informational notes that do NOT affect the verdict (e.g. mandatory hurricane deductible).
function infoNotesFor(lead: Lead): string[] {
  const coast = coastalFor(lead);
  return coast.eligible && coast.note ? [coast.note] : [];
}

const PASS_NOTE: Record<'travelers' | 'plymouth', string> = {
  travelers: 'Meets all Travelers Quantum Home 2.0 NJ eligibility criteria',
  plymouth: 'Meets all Plymouth Rock (AtHome Insurance) NJ eligibility criteria',
};

// ─── Engine ──────────────────────────────────────────────────────────────────

function evaluateCarrier(lead: Lead, carrier: 'travelers' | 'plymouth'): CarrierRuleResult {
  const reasons: RuleHit[] = [];
  for (const rule of APPETITE_RULES) {
    if (rule.carrier !== 'both' && rule.carrier !== carrier) continue;
    if (rule.applies(lead)) {
      reasons.push({ code: rule.code, severity: rule.severity, message: rule.message(lead, carrier) });
    }
  }

  const verdict: Verdict =
    reasons.some((r) => r.severity === 'FAIL') ? 'FAIL'
      : reasons.some((r) => r.severity === 'REFER') ? 'REFER'
        : 'PASS';

  const notes = [...reasons.map((r) => r.message), ...infoNotesFor(lead)];
  if (verdict === 'PASS' && notes.length === 0) notes.push(PASS_NOTE[carrier]);

  return { status: statusFromVerdict(verdict), verdict, notes, reasons };
}

// ─── Public API (signatures unchanged — now backed by the rule engine) ─────────

export function checkTravelersEligibility(lead: Lead): CarrierRuleResult {
  return evaluateCarrier(lead, 'travelers');
}

export function checkPlymouthRockEligibility(lead: Lead): CarrierRuleResult {
  return evaluateCarrier(lead, 'plymouth');
}

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
