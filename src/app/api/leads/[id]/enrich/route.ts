import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, addActivity } from '@/services/storage.service';
import { enrichLead } from '@/services/enrichment.service';

/**
 * POST /api/leads/[id]/enrich
 *
 * Runs the enrichment pipeline for ONE lead: carrier appetite → FEMA flood → grade →
 * indicative pricing → coast distance.
 *
 * ── Why per-lead ────────────────────────────────────────────────────────────
 * /api/enrich already existed and re-enriches the entire book — 9,938 leads, every grade
 * recomputed. That is precisely the kind of unannounced mass operation that cost a
 * meeting on 17 Sep 2026, and it is not something to hand anyone as a button.
 *
 * This exists because a lead can sit in the CRM having never been enriched at all: 257
 * of them carry no carrier verdict, no flood check and no grade. They still show in
 * reports, with dashes where Travelers and Plymouth should be, and their grade — when a
 * regrade gave them one — is provisional, because flood can still cap it.
 *
 * FREE. Carrier appetite and grading are computed locally and the FEMA lookup is a public
 * API; no REAPI or Tracerfy credits are consumed. That is what makes it safe to expose.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const before = await getLeadByPropertyId(id) as any;
    if (!before) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    await enrichLead(before);

    const after = await getLeadByPropertyId(id) as any;

    /**
     * enrichLead writes its own 'grade_system' activity when the grade moves, but says
     * nothing when it does not — so a run that filled in the carrier verdicts and the
     * flood zone while leaving the grade alone would leave no trace of having happened.
     * A person pressed a button; that is an action, and the whole point of this week's
     * work is that actions are recorded whether or not they changed a headline number.
     */
    const filled: string[] = [];
    if (!before.travelersEligible && after?.travelersEligible) filled.push('Travelers');
    if (!before.plymouthEligible && after?.plymouthEligible) filled.push('Plymouth Rock');
    if (!before.floodCheckedAt && after?.floodCheckedAt) filled.push('flood zone');
    if (!before.indicativeBandLow && after?.indicativeBandLow) filled.push('indicative band');

    const gradeMoved = before.grade !== after?.grade;
    await addActivity(
      before.id,
      'enrichment',
      `Enrichment run${filled.length ? ` — filled in ${filled.join(', ')}` : ' — no new data'}`
        + `${gradeMoved ? ` · grade ${before.grade ?? '—'} → ${after?.grade ?? '—'}` : ''}`,
      {
        filled,
        gradeBefore: before.grade ?? null,
        gradeAfter: after?.grade ?? null,
        travelers: after?.travelersEligible ?? null,
        plymouth: after?.plymouthEligible ?? null,
      },
    );

    return NextResponse.json({
      success: true,
      data: after,
      filled,
      gradeBefore: before.grade ?? null,
      gradeAfter: after?.grade ?? null,
    });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/enrich error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Enrichment failed' },
      { status: 500 },
    );
  }
}
