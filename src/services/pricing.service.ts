import { Lead } from '@/types/lead';
import { IndicativePremium } from '@/types/pricing';

// NJ average homeowners insurance rate is roughly 0.45–0.65% of home value annually
const BASE_RATE = 0.005; // 0.5% of estimated value

/**
 * Calculate an indicative premium range for a NJ homeowner lead.
 *
 * This is NOT a final quote. It is a rule-based estimate to help the producer
 * present a ballpark range before running the carrier POS quote.
 *
 * Confidence score reflects how many pricing inputs are available (0–100).
 */
export function calculateIndicativePremium(lead: Lead): IndicativePremium {
  const value = lead.estimatedValue || 0;

  if (value === 0) {
    return { low: 0, expected: 0, high: 0, confidenceScore: 0 };
  }

  const currentYear = new Date().getFullYear();

  // Age factor — older homes cost more to insure
  let ageFactor = 1.0;
  if (lead.yearBuilt) {
    const age = currentYear - lead.yearBuilt;
    if (age > 60) ageFactor = 1.35;
    else if (age > 40) ageFactor = 1.20;
    else if (age > 20) ageFactor = 1.08;
    else ageFactor = 1.0;
  }

  // Flood factor — coastal / flood zone adds significant premium
  let floodFactor = 1.0;
  if (lead.floodZone) {
    const zone = (lead.floodZoneType || '').toUpperCase();
    if (zone.startsWith('V')) floodFactor = 1.80;       // coastal high velocity — most expensive
    else if (zone.startsWith('AE')) floodFactor = 1.50; // special flood hazard
    else if (zone.startsWith('A')) floodFactor = 1.35;  // other A zones
    else floodFactor = 1.15;                            // X zone (moderate risk)
  }

  // Size factor — larger homes have higher replacement cost
  let sqftFactor = 1.0;
  if (lead.squareFeet) {
    if (lead.squareFeet > 4000) sqftFactor = 1.20;
    else if (lead.squareFeet > 2500) sqftFactor = 1.10;
    else if (lead.squareFeet < 800) sqftFactor = 0.90;
  }

  // Pool factor — liability surcharge
  const poolFactor = lead.pool ? 1.06 : 1.0;

  // Owner-occupancy discount — owner-occupied = better loss history
  const ownerFactor = lead.ownerOccupied === false ? 1.12 : 1.0;

  const expected = Math.round(
    value * BASE_RATE * ageFactor * floodFactor * sqftFactor * poolFactor * ownerFactor
  );

  // Low = best-case (newer, no issues), High = worst-case (surcharges applied)
  const low = Math.round(expected * 0.82);
  const high = Math.round(expected * 1.22);

  // Confidence score — based on how many key inputs are available
  const inputs = [
    lead.estimatedValue,
    lead.yearBuilt,
    lead.squareFeet,
    lead.floodZone !== undefined ? 1 : null,
    lead.ownerOccupied !== undefined ? 1 : null,
  ];
  const presentCount = inputs.filter((v) => v !== null && v !== undefined).length;
  const confidenceScore = Math.round((presentCount / inputs.length) * 100);

  return { low, expected, high, confidenceScore };
}

/**
 * Format premium as a display string.
 */
export function formatPremium(amount: number): string {
  if (!amount) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Get a confidence label from a score.
 */
export function getConfidenceLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'High', color: '#2e7d32' };
  if (score >= 50) return { label: 'Medium', color: '#f57c00' };
  return { label: 'Low', color: '#c62828' };
}
