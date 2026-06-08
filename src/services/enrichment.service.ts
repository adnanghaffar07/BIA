import { Lead } from '@/types/lead';
import { checkCarrierEligibility } from './carrier.service';
import { calculateLeadGrade } from './grade.service';
import { calculateIndicativePremium } from './pricing.service';
import { updateLead } from './storage.service';

/**
 * Run the full enrichment pipeline on a single lead:
 *   1. Carrier appetite check (Travelers + Plymouth Rock)
 *   2. Carrier-aware lead grading (A–D)
 *   3. Indicative premium calculation
 *   4. Persist results back to DB
 *
 * This is called automatically after ingesting properties from the Real Estate API.
 */
export async function enrichLead(lead: any): Promise<void> {
  try {
    // Support both raw API objects (propertyId or id) and DB records
    const propertyId: string = lead.propertyId || lead.id;
    if (!propertyId) return;

    // Map raw API object to Lead shape if address is nested
    const mappedLead: Lead = {
      ...lead,
      id: propertyId,
      propertyId,
      address: lead.address || {
        address: lead.addressFull || lead.addressStreet || '',
        street: lead.addressStreet || '',
        city: lead.addressCity || '',
        state: lead.addressState || 'NJ',
        zip: lead.addressZip || '',
        county: lead.addressCounty,
      },
      propertyType: lead.propertyType || '',
      propertyUse: lead.propertyUse || '',
      landUse: lead.landUse || '',
    };

    const eligibility = checkCarrierEligibility(mappedLead);
    const grade = calculateLeadGrade(mappedLead, eligibility);
    const pricing = calculateIndicativePremium(mappedLead);

    await updateLead(propertyId, {
      grade,
      travelersEligible: eligibility.travelers.status,
      travelersNotes: eligibility.travelers.notes as any,
      plymouthEligible: eligibility.plymouthRock.status,
      plymouthNotes: eligibility.plymouthRock.notes as any,
      lowPremium: pricing.low || undefined,
      expectedPremium: pricing.expected || undefined,
      highPremium: pricing.high || undefined,
      pricingConfidence: pricing.confidenceScore,
    });
  } catch (err) {
    console.error(`[enrichment] Failed to enrich lead ${lead.propertyId}:`, err);
  }
}

/**
 * Run enrichment on a batch of leads (after DB ingest).
 */
export async function enrichLeadBatch(leads: any[]): Promise<{
  enriched: number;
  failed: number;
}> {
  let enriched = 0;
  let failed = 0;

  for (const lead of leads) {
    try {
      await enrichLead(lead);
      enriched++;
    } catch {
      failed++;
    }
  }

  return { enriched, failed };
}

/**
 * Re-run enrichment on a single lead fetched from DB.
 * Useful when manually triggering a re-check from the UI.
 */
export async function reEnrichLead(dbLead: any): Promise<any> {
  // Map DB record back to Lead shape for the services
  const lead: Lead = {
    id: dbLead.id,
    propertyId: dbLead.propertyId,
    address: {
      address: dbLead.addressFull || dbLead.addressStreet,
      street: dbLead.addressStreet,
      city: dbLead.addressCity,
      state: dbLead.addressState,
      zip: dbLead.addressZip,
      county: dbLead.addressCounty || undefined,
    },
    propertyType: dbLead.propertyType || '',
    propertyUse: dbLead.propertyUse || '',
    landUse: dbLead.landUse || '',
    yearBuilt: dbLead.yearBuilt || undefined,
    squareFeet: dbLead.squareFeet || undefined,
    estimatedValue: dbLead.estimatedValue || undefined,
    lastSaleDate: dbLead.lastSaleDate || undefined,
    recordingDate: dbLead.recordingDate || undefined,
    owner1LastName: dbLead.owner1LastName || undefined,
    owner1FirstName: dbLead.owner1FirstName || undefined,
    corporateOwned: dbLead.corporateOwned ?? undefined,
    ownerOccupied: dbLead.ownerOccupied ?? undefined,
    absenteeOwner: dbLead.absenteeOwner ?? undefined,
    investorBuyer: dbLead.investorBuyer ?? undefined,
    vacant: dbLead.vacant ?? undefined,
    preForeclosure: dbLead.preForeclosure ?? undefined,
    foreclosure: dbLead.foreclosure ?? undefined,
    reo: dbLead.reo ?? undefined,
    floodZone: dbLead.floodZone ?? undefined,
    floodZoneType: dbLead.floodZoneType || undefined,
    pool: dbLead.pool ?? undefined,
  };

  await enrichLead(lead);
  return lead;
}
