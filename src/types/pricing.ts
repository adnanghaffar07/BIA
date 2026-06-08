export interface IndicativePremium {
  low: number;
  expected: number;
  high: number;
  confidenceScore: number; // 0-100
}

export interface PricingInputs {
  estimatedValue?: number;
  yearBuilt?: number;
  squareFeet?: number;
  floodZone?: boolean;
  floodZoneType?: string;
  pool?: boolean;
  propertyUse?: string;
}
