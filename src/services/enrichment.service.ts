import { Lead } from '@/types/lead';
import { checkCarrierEligibility } from './carrier.service';
import { calculateCoastDistance } from './coastDistance.service';
import { calculateLeadGrade } from './grade.service';
import { calculateIndicativePremium } from './pricing.service';
import { getFemaFloodZone } from './femaFlood.service';
import { getEffectiveDate } from './pipeline.service';
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

    // Effective date for triage — auto-compute if a producer hasn't set one.
    const effPatch: Record<string, any> = {};
    if (!lead.effectiveDate) {
      const eff = getEffectiveDate(mappedLead);
      if (eff) effPatch.effectiveDate = eff.toISOString().slice(0, 10);
    }

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
      ...effPatch,
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

// NOTE: a `reEnrichLead(dbLead)` helper used to live here for a "re-check from the UI"
// feature that was never built. It hand-mapped a DB row into a nested-only Lead and
// dropped mailStreet/mailCity entirely, which would have silently blinded the
// investor / non-owner-occupancy and ZIP-appetite rules. Removed rather than fixed:
// enrichLead() already accepts a DB row directly (it spreads the record, so both the
// flat and nested shapes survive). To re-enrich one lead, call enrichLead(dbRow).
