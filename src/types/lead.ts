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
  boundPremium?: number;
  boundDate?: string;
  authorizationDate?: string;

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
