// Property Address Info
export interface PropertyAddress {
  address: string;
  city: string;
  county?: string;
  fips?: string;
  state: string;
  street: string;
  zip: string;
}

// Main Property/Lead Object from Real Estate API v2
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
  
  // Owner Info
  companyName?: string;
  owner1LastName?: string;
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
  
  // Mortgage Info
  openMortgageBalance?: number;
  lenderName?: string;
  
  // Coordinates
  latitude?: number;
  longitude?: number;
  
  // Document Info
  documentType?: string;
  documentTypeCode?: string;
  
  // Additional Fields
  medianIncome?: string;
  status?: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  notes?: string;
}

// Filter options for properties
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
}

export interface LeadPageFilters {
  limit?: number;
  offset?: number;
  search?: string;
  ids_only?: boolean;
  obfuscate?: boolean;
  summary?: boolean;
}
