import { Lead } from '@/types/lead';
import { checkCarrierEligibility } from './carrier.service';
import { calculateCoastDistance } from './coastDistance.service';
import { calculateLeadGrade } from './grade.service';
import { calculateIndicativePremium } from './pricing.service';
import { getFemaFloodZone } from './femaFlood.service';
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

    // FEMA NFHL flood lookup (authoritative). Skip when a producer has manually
    // overridden the zone — never clobber a manual entry. Failures are swallowed
    // inside getFemaFloodZone, so this never breaks enrichment.
    let floodPatch: Record<string, any> = {};
    if (!(lead.floodZoneManual === true)) {
      const fema = await getFemaFloodZone(mappedLead.latitude, mappedLead.longitude);
      if (fema) {
        // Reflect onto mappedLead so the grade computation sees fresh flood data.
        mappedLead.floodZoneType = fema.zone ?? undefined;
        (mappedLead as any).floodZoneSubtype = fema.subtype ?? undefined;
        (mappedLead as any).floodSfha = fema.sfha;
        mappedLead.floodZone = fema.sfha;
        floodPatch = {
          floodZone: fema.sfha,
          floodZoneType: fema.zone ?? undefined,
          floodZoneSubtype: fema.subtype ?? undefined,
          floodSfha: fema.sfha,
          floodCheckedAt: new Date().toISOString(),
        };
      }
    }

    // Honor a producer's manual grade override — never clobber it with the
    // computed grade on re-enrichment (§2/§11 real-time upgrade/downgrade).
    const computedGrade = calculateLeadGrade(mappedLead, eligibility);
    const grade = (mappedLead as any).manualGrade || computedGrade;
    const pricing = calculateIndicativePremium(mappedLead);
    const coast = calculateCoastDistance(mappedLead.latitude, mappedLead.longitude);

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
      ...(coast && {
        coastDistanceMiles: coast.distanceMiles,
        coastExposure: coast.exposure,
      }),
      ...floodPatch,
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
    roofYear: dbLead.roofYear || undefined,
    manualGrade: dbLead.manualGrade || undefined,
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
    floodZoneSubtype: dbLead.floodZoneSubtype || undefined,
    floodSfha: dbLead.floodSfha ?? undefined,
    floodZoneManual: dbLead.floodZoneManual ?? undefined,
    pool: dbLead.pool ?? undefined,
    latitude: dbLead.latitude ? parseFloat(dbLead.latitude) : undefined,
    longitude: dbLead.longitude ? parseFloat(dbLead.longitude) : undefined,
  };

  await enrichLead(lead);
  return lead;
}
