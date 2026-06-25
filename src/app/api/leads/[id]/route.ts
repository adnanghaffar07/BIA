import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: lead });
  } catch (error) {
    console.error('GET /api/leads/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch lead' }, { status: 500 });
  }
}

/**
 * PUT /api/leads/[id]
 * Update CRM fields. Auto-stamps funnel timestamps based on transitions:
 *   status → 'contacted' for the first time  → sets firstRpcAt
 *   posQuoteNumber set for the first time     → sets quotedAt
 *   posQuotePremium + expectedPremium present → computes variancePct
 *   status → 'lost'                           → requires lostReason + lostStage
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { _activityNote, _activityType, _createdBy, ...updateData } = body;

    // Fetch current lead state to drive auto-stamp logic
    const existing = await getLeadByPropertyId(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const now = new Date();

    // Producer edit — stamp who/when so this lead surfaces in "Recently Edited".
    updateData.lastEditedAt = now;
    updateData.lastEditedBy = _createdBy ?? existing.lastEditedBy ?? null;

    // Auto-stamp: firstRpcAt — set once when the lead first moves off 'new'
    // (producer engagement = enters the active queue, Frank Phase 5).
    if (
      updateData.status &&
      updateData.status !== 'new' &&
      !existing.firstRpcAt &&
      existing.status === 'new'
    ) {
      updateData.firstRpcAt = now;
    }

    // Auto-increment: contactAttempts on each producer-stage transition
    if (
      updateData.status &&
      ['rated', 'indicative_sent', 'pos_ran', 'quote_issued'].includes(updateData.status) &&
      updateData.status !== existing.status
    ) {
      updateData.contactAttempts = (existing.contactAttempts ?? 0) + 1;
    }

    // Auto-stamp: quotedAt — set once when posQuoteNumber is first provided
    if (updateData.posQuoteNumber && !existing.posQuoteNumber && !existing.quotedAt) {
      updateData.quotedAt = now;
    }

    // Auto-compute: variancePct when we have both posQuotePremium and expectedPremium
    const newPosQuote = updateData.posQuotePremium ?? existing.posQuotePremium;
    const expectedPremium = existing.expectedPremium;
    if (newPosQuote && expectedPremium) {
      updateData.variancePct = Math.round(
        ((newPosQuote - expectedPremium) / expectedPremium) * 10000
      ) / 100; // stored as percent e.g. 12.34
    }

    // Auto-stamp: boundDate when status first moves to 'bound'
    if (updateData.status === 'bound' && existing.status !== 'bound' && !existing.boundDate) {
      updateData.boundDate = now;
    }

    // Manual grade override (§2/§11): a producer can upgrade/downgrade a lead.
    // When manualGrade is set, mirror it into `grade` (so queue/dashboard filters
    // pick it up) and stamp who/when. An empty string clears the override; the
    // computed grade is restored on the next enrichment pass.
    if ('manualGrade' in updateData) {
      const mg = updateData.manualGrade;
      if (mg && ['A', 'B', 'C', 'D'].includes(mg)) {
        updateData.grade = mg;
        updateData.gradeOverrideAt = now;
        updateData.gradeOverrideBy = _createdBy ?? updateData.gradeOverrideBy;
      } else {
        // Clear the override (leave `grade` as-is until re-enrichment recomputes it)
        updateData.manualGrade = null;
        updateData.gradeOverrideReason = null;
        updateData.gradeOverrideBy = null;
        updateData.gradeOverrideAt = null;
      }
    }

    await updateLead(id, updateData);

    if (_activityNote) {
      await addActivity(
        existing.id,
        _activityType || 'note',
        _activityNote,
        updateData,
        _createdBy
      );
    }

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('PUT /api/leads/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update lead' }, { status: 500 });
  }
}
