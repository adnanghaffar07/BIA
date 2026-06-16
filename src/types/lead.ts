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

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'quote_sent'
  | 'bound'
  | 'lost';

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
