import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { getFemaFloodZone, floodGradeFromFema } from '@/services/femaFlood.service';

/**
 * POST /api/leads/[id]/flood
 *
 * Producer self-serve FEMA flood re-check (FREE — public FEMA NFHL API, no
 * credits). Looks up the authoritative flood zone for the lead's coordinates and
 * stamps floodZone/zoneType/subtype/SFHA + floodCheckedAt. Applies Frank's
 * flood→grade cap (SFHA → D, shaded-X 0.2% → C) without ever worsening below the
 * existing grade or overriding a manual grade. A manual flood override is never
 * clobbered.
 */
const RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id) as any;
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    if (lead.floodZoneManual === true) {
      return NextResponse.json(
        { success: false, error: 'Flood zone is manually overridden — clear the override to re-check FEMA.' },
        { status: 400 },
      );
    }
    if (lead.latitude == null || lead.longitude == null) {
      return NextResponse.json(
        { success: false, error: 'Lead has no coordinates to look up.' },
        { status: 400 },
      );
    }

    const fema = await getFemaFloodZone(lead.latitude, lead.longitude);
    if (!fema) {
      return NextResponse.json(
        { success: false, error: 'FEMA lookup failed or timed out — please try again.' },
        { status: 502 },
      );
    }

    const update: Record<string, any> = {
      floodZone: fema.sfha,
      floodZoneType: fema.zone ?? undefined,
      floodZoneSubtype: fema.subtype ?? undefined,
      floodSfha: fema.sfha,
      floodCheckedAt: new Date().toISOString(),
    };

    // Flood grade cap — only worsen, never below an existing grade, never over manual.
    const cap = floodGradeFromFema(fema);
    if (cap && !lead.manualGrade && (RANK[cap] ?? 0) > (RANK[lead.grade] ?? 0)) {
      update.grade = cap;
    }

    await updateLead(id, update);
    await addActivity(
      lead.id,
      'flood_check',
      `FEMA flood re-check: ${fema.zone ?? '—'}${fema.sfha ? ' (SFHA high-risk)' : ''}${update.grade ? ` → grade ${update.grade}` : ''}`,
      { zone: fema.zone, subtype: fema.subtype, sfha: fema.sfha },
    );

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({ success: true, data: updated, result: fema });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/flood error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Flood re-check failed' },
      { status: 500 },
    );
  }
}
