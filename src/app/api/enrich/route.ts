import { NextResponse } from 'next/server';
import { getLeadsFromDb } from '@/services/storage.service';
import { enrichLeadBatch } from '@/services/enrichment.service';

/**
 * POST /api/enrich
 *
 * Re-runs the full enrichment pipeline (carrier check → grade → pricing)
 * on all leads already stored in Neon.
 *
 * Safe to call repeatedly — does NOT consume any REAPI credits.
 * Use this after updating carrier rules, grade thresholds, or pricing logic.
 */
export async function POST() {
  try {
    // Fetch all leads in batches of 50 to avoid memory pressure
    const BATCH = 50;
    let offset = 0;
    let totalEnriched = 0;
    let totalFailed = 0;

    while (true) {
      const leads = await getLeadsFromDb({ limit: BATCH, offset });
      if (leads.length === 0) break;

      const { enriched, failed } = await enrichLeadBatch(leads);
      totalEnriched += enriched;
      totalFailed += failed;
      offset += leads.length;

      // Stop if we got fewer than a full batch (last page)
      if (leads.length < BATCH) break;
    }

    console.log(`[enrich] Re-enrichment complete: ${totalEnriched} enriched, ${totalFailed} failed`);

    return NextResponse.json({
      success: true,
      enriched: totalEnriched,
      failed: totalFailed,
      message: `Re-enrichment complete. ${totalEnriched} leads updated with new carrier rules and grades.`,
    });
  } catch (error) {
    console.error('[enrich] Re-enrichment error:', error);
    return NextResponse.json(
      { success: false, error: 'Re-enrichment failed' },
      { status: 500 }
    );
  }
}
