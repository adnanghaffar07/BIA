export interface PropertyAddress {
  address: string;
  city: string;
  county?: string;
  fips?: string;
  state: string;
  street: string;
  zip: string;
}

export interface CarrierEligibility {
  travelers: 'eligible' | 'ineligible' | 'review';
  travelersNotes: string[];
  plymouthRock: 'eligible' | 'ineligible' | 'review';
  plymouthRockNotes: string[];
}

export interface IndicativePremium {
  low: number;
  expected: number;
  high: number;
  confidenceScore: number; // 0-100
}

export interface ContactInfo {
  phone1?: string;
  phone2?: string;
  email1?: string;
  email2?: string;
  skipTracedAt?: string;
}

// 1 = New Purchase (mortgage within last ~90 days)
// 2 = Renewal / Win-Back (mortgage from 2022-2025)
export type PipelineEngine = 1 | 2;

export type LeadGradeValue = 'A' | 'B' | 'C' | 'D';

// Frank Phase 5 workflow: NEW → RATED → INDICATIVE PRICING SENT → POS RAN → QUOTE ISSUED → BOUND/LOST
export type LeadStatus =
  | 'new'
  | 'rated'
  | 'indicative_sent'
  | 'pos_ran'
  | 'quote_issued'
  | 'bound'
  | 'lost';

/** Single source of truth for status display + workflow grouping (Frank Phase 5). */
export const LEAD_STATUS_OPTIONS: Array<{
  value: LeadStatus;
  label: string;
  color: 'info' | 'warning' | 'primary' | 'secondary' | 'success' | 'error';
}> = [
  { value: 'new',             label: 'New',                     color: 'info' },
  { value: 'rated',           label: 'Rated',                   color: 'secondary' },
  { value: 'indicative_sent', label: 'Indicative Pricing Sent', color: 'warning' },
  { value: 'pos_ran',         label: 'POS Ran',                 color: 'warning' },
  { value: 'quote_issued',    label: 'Quote Issued',            color: 'primary' },
  { value: 'bound',           label: 'Bound',                   color: 'success' },
  { value: 'lost',            label: 'Lost',                    color: 'error' },
];

export function leadStatusLabel(s: string | null | undefined): string {
  return LEAD_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? 'New';
}

/** Producer-engaged statuses (past 'new', not yet closed) — these belong in the queue. */
export const ACTIVE_PRODUCER_STATUSES: LeadStatus[] = ['rated', 'indicative_sent', 'pos_ran', 'quote_issued'];
/** Closed / terminal statuses. */
export const CLOSED_STATUSES: LeadStatus[] = ['bound', 'lost'];

export type LostReason =
  | 'price'
  | 'no_contact'
  | 'not_authorized'
  | 'out_of_appetite'
  | 'bought_elsewhere'
  | 'not_interested'
  | 'other';

export type LostStage =
  | 'in_appetite'       // fell out before rating-complete
  | 'rating_complete'   // had data but never contacted
  | 'right_party'       // could never reach decision-maker
  | 'authorization'     // reached but would not authorize quote
  | 'quoted'            // quoted but did not bind
  | 'unknown';

export type AuthorizationMethod = 'verbal' | 'web' | 'email';

export interface Lead {
  id: string;
  propertyId: string;
  address: PropertyAddress;
  mailAddress?: PropertyAddress;

  // Property Details
  propertyType: string;
  propertyUse: string;
  propertyUseCode?: number;
  landUse: string;

  // Building Info
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  lotSquareFeet?: number;
  yearBuilt?: number;
  unitsCount?: number;
  roomsCount?: number;
  stories?: number;

  // Financial Info
  estimatedValue?: number;
  assessedValue?: number;
  assessedLandValue?: number;
  assessedImprovementValue?: number;
  lastSaleAmount?: string;
  lastSaleDate?: string;
  estimatedEquity?: number;
  suggestedRent?: string;
  openMortgageBalance?: number;
  lenderName?: string;
  mortgageType?: string;

  // Owner Info
  owner1LastName?: string;
  owner1FirstName?: string;
  companyName?: string;
  ownerOccupied?: boolean;
  corporateOwned?: boolean;
  absenteeOwner?: boolean;
  investorBuyer?: boolean;

  // Amenities & Features
  garage?: boolean;
  pool?: boolean;
  deck?: boolean;
  patio?: boolean;
  basement?: boolean;
  airConditioningAvailable?: boolean;

  // Property Conditions
  vacant?: boolean;
  preForeclosure?: boolean;
  foreclosure?: boolean;
  reo?: boolean;
  highEquity?: boolean;
  floodZone?: boolean;
  floodZoneType?: string;
  floodZoneSubtype?: string;   // FEMA ZONE_SUBTY (e.g. '0.2 PCT ANNUAL CHANCE FLOOD HAZARD')
  floodSfha?: boolean;         // FEMA SFHA_TF — true = Special Flood Hazard Area (high-risk)
  floodZoneManual?: boolean;   // producer override — FEMA enrichment won't overwrite
  floodCheckedAt?: string;     // ISO timestamp of last FEMA lookup
  hoa?: boolean;

  // Tax & Legal Info
  apn?: string;
  parcelAccountNumber?: string;
  fips?: string;

  // Dates
  recordingDate?: string;
  lastUpdateDate?: string;

  // Coordinates
  latitude?: number;
  longitude?: number;

  // Document Info
  documentType?: string;
  documentTypeCode?: string;

  // Additional Fields
  medianIncome?: string;

  // ─── CRM-computed fields ──────────────────────────────────────────────────

  // Pipeline engine assignment
  engine?: PipelineEngine;
  renewalTargetDate?: string;

  // Skip trace results (populated ONLY after carrier qualification)
  skipTraced?: boolean;
  skipTracedAt?: string;
  /** Full REAPI v2 SkipTrace response (identity, phones, emails, demographics, …). */
  skipTraceData?: any;
  phone1?: string;
  phone2?: string;
  email1?: string;
  email2?: string;

  // Carrier eligibility
  carrierEligibility?: CarrierEligibility;

  // Indicative pricing
  indicativePremium?: IndicativePremium;

  // Workflow status
  status?: LeadStatus;

  // Producer workflow
  producerEmail?: string;
  posQuoteNumber?: string;
  posCarrier?: string;
  posQuotePremium?: number;       // §10E actual POS dollar quote
  quotedAt?: string;              // §10E timestamp when POS quote produced
  boundPremium?: number;
  boundDate?: string;
  authorizationDate?: string;
  authorizationMethod?: AuthorizationMethod; // §10D verbal/web/email

  // §10D workflow timestamps
  queueEnteredAt?: string;
  firstRpcAt?: string;
  contactAttempts?: number;

  // §10E variance / moat
  varianceNotes?: string;
  varianceReason?: string;
  varianceAmount?: number;
  variancePct?: number;           // (posQuotePremium − expectedPremium) / expectedPremium

  // §10E disposition
  lostReason?: LostReason;
  lostStage?: LostStage;

  // §10A sourcing
  sourceVendor?: string;
  cohortTag?: string;

  // §10B rating readiness
  roofYear?: number;
  // Roof covering material. Defaults to 'Unknown' until a data source / producer
  // confirms it (Frank, Jun 2026). Only an explicitly high-risk covering
  // (flat-metal/tile/wood) is a carrier knockout — 'Unknown' is never penalized.
  roofType?: string;
  constructionType?: string;
  protectionClass?: string;
  priorCarrier?: string;
  priorPremium?: number;
  indicativeBasis?: string;

  // ─── Frank Jun-2026: dual insureds, DOB, confirm-on-call, home features ─────
  // Both named insureds — husband + wife are almost always both on the HO policy
  owner2FirstName?: string;
  owner2LastName?: string;
  maritalStatus?: 'married' | 'single' | 'unknown';
  owner1Dob?: string;            // ISO date — drives the insurance score (Travelers requires it)
  owner2Dob?: string;

  // Confirm-on-call — unknown until first contact is made
  dogBreed?: string;             // restricted-breed name | 'none' | undefined = unknown
  insuranceHistory?: 'currently_insured' | 'lapsed' | 'new' | 'unknown'; // assumed currently_insured
  heatingRenovatedYear?: number;
  bathroomsFull?: number;
  bathroomsHalf?: number;

  // Home features — listing-sourced or manual
  garageType?: 'attached' | 'detached' | 'none';
  garageCount?: number;
  sidingType?: string;
  foundationType?: 'basement' | 'crawl_space' | 'slab';
  heatSource?: string;           // defaults to 'gas' for NJ
  feetFromHydrant?: number;

  // Travelers "Home Features" protective devices
  burglarAlarm?: 'local' | 'smart' | 'central' | 'none';
  fireAlarm?: 'local' | 'central' | 'none';
  sprinklerSystem?: boolean;
  smokeDetector?: 'regular' | 'smart' | 'none';
  waterSensor?: 'regular' | 'smart' | 'central' | 'none';
  autoWaterShutoff?: 'regular' | 'smart' | 'none';
  lowTempSensor?: 'regular' | 'smart' | 'central' | 'none';
  leedCertified?: boolean;

  // Effective date — tied to the new-purchase / renewal 90-day logic
  effectiveDate?: string;

  // ─── Frank Phase 5: editable carrier pricing + close-out ────────────────────
  travelersPremium?: number;   // producer-entered Travelers indicative $
  plymouthPremium?: number;    // producer-entered Plymouth Rock indicative $
  assignedCarrier?: 'travelers' | 'plymouth'; // the cheaper / front-running carrier
  doNotRevisit?: boolean;      // close-out: explicitly do NOT revisit next year

  // ─── Frank Phase 5b: Home Upgrades + basement finish ────────────────────────
  basementFinishedPct?: string; // % complete when foundation = basement
  bathroomGrade?: string;       // Builders Grade | Semi-Custom | Custom | Designer
  kitchenCount?: number;
  kitchenGrade?: string;

  // Manual grade override — BIA staff can upgrade/downgrade with a comment (§2, §11)
  manualGrade?: LeadGradeValue;
  gradeOverrideReason?: string;
  gradeOverrideBy?: string;
  gradeOverrideAt?: string;

  // Revisit / future re-engagement (§4A — "revisit next year")
  revisitFlag?: boolean;
  revisitDate?: string;
  revisitNote?: string;

  // Lost-to-competitor price capture (§4A — track what we're up against)
  competitorCarrier?: string;
  competitorPremium?: number;

  // Notes (legacy simple field — full history lives in Activity table)
  notes?: string;
}

export interface LeadFilters {
  search?: string;
  propertyType?: string;
  landUse?: string;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  maxBathrooms?: number;
  minValue?: number;
  maxValue?: number;
  state?: string;
  county?: string;
  zipCode?: string;
  investorBuyer?: boolean;
  highEquity?: boolean;
  preForeclosure?: boolean;
  size?: number;
  engine?: PipelineEngine;
  grade?: LeadGradeValue;
  status?: LeadStatus;
}

export interface LeadPageFilters {
  limit?: number;
  offset?: number;
  search?: string;
  ids_only?: boolean;
  obfuscate?: boolean;
  summary?: boolean;
}
