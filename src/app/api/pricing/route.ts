import { NextRequest, NextResponse } from 'next/server';
import { calculateIndicativePremium } from '@/services/pricing.service';
import { checkCarrierEligibility } from '@/services/carrier.service';
import { getLeadByPropertyId, updateLead } from '@/services/storage.service';

/**
 * POST /api/pricing
 * Calculate indicative premium for a lead.
 * Body: { propertyId } — looks up from DB and returns pricing
 *
 * Also accepts a full lead object directly if propertyId is not in DB yet.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { propertyId, ...leadData } = body;

    let lead: any = leadData;

    // If propertyId given, fetch from DB first
    if (propertyId) {
      const dbLead = await getLeadByPropertyId(propertyId);
      if (dbLead) {
        lead = {
          ...dbLead,
          address: {
            address: dbLead.addressFull || dbLead.addressStreet,
            street: dbLead.addressStreet,
            city: dbLead.addressCity,
            state: dbLead.addressState,
            zip: dbLead.addressZip,
          },
        };
      }
    }

    if (!lead) {
      return NextResponse.json(
        { success: false, error: 'Lead not found' },
        { status: 404 }
      );
    }

    const pricing = calculateIndicativePremium(lead);
    const eligibility = checkCarrierEligibility(lead);

    // Persist updated pricing if we have a DB record
    if (propertyId) {
      await updateLead(propertyId, {
        lowPremium: pricing.low || undefined,
        expectedPremium: pricing.expected || undefined,
        highPremium: pricing.high || undefined,
        pricingConfidence: pricing.confidenceScore,
      });
    }

    return NextResponse.json({
      success: true,
      pricing,
      eligibility: {
        travelers: eligibility.travelers.status,
        plymouthRock: eligibility.plymouthRock.status,
        passesAnyCarrier: eligibility.passesAnyCarrier,
      },
    });
  } catch (error) {
    console.error('POST /api/pricing error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to calculate pricing' },
      { status: 500 }
    );
  }
}
