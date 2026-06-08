import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';

/**
 * GET /api/leads/[id]
 * Fetch a single lead by propertyId including full activity history.
 */
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
    return NextResponse.json(
      { success: false, error: 'Failed to fetch lead' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/leads/[id]
 * Update CRM-managed fields on a lead. Also logs an activity entry.
 *
 * Body: { field updates } + optional { _activityNote, _activityType, _createdBy }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Strip meta fields used only for activity logging
    const { _activityNote, _activityType, _createdBy, ...updateData } = body;

    await updateLead(id, updateData);

    // Log activity if a note was provided
    if (_activityNote) {
      const lead = await getLeadByPropertyId(id);
      await addActivity(
        lead?.id ?? id,
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
    return NextResponse.json(
      { success: false, error: 'Failed to update lead' },
      { status: 500 }
    );
  }
}
