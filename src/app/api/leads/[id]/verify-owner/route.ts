import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { verifyOwnerName, WIPP_BY_ZIP } from '@/services/taxRoll.service';

/**
 * POST /api/leads/[id]/verify-owner
 *
 * Confirms the insured name against the municipal tax roll for this property and
 * caches the outcome on the lead. Free (no REAPI credits) but it does hit an
 * external municipal service, so it is deliberately ON DEMAND — one lead, one
 * producer click — rather than a bulk sweep.
 *
 * Re-checking an already-verified lead is a no-op unless ?force=1, so repeat visits
 * to a lead never re-query the township.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const l = lead as any;
    const zip = String(l.addressZip ?? '').trim();
    const munis = WIPP_BY_ZIP[zip];
    // A ZIP can span several municipalities (e.g. 07726 = Manalapan + Englishtown).
    const townLabel = munis?.map((m) => m.town).join(' / ') ?? '';
    if (!munis?.length) {
      return NextResponse.json({
        success: false,
        error: `No tax-roll lookup configured for ZIP ${zip || '—'}. Supported: ${Object.keys(WIPP_BY_ZIP).join(', ') || 'none yet'}.`,
      }, { status: 400 });
    }

    // Cached result wins unless the caller explicitly forces a re-check.
    const force = request.nextUrl.searchParams.get('force') === '1';
    if (l.ownerVerifyStatus && !force) {
      return NextResponse.json({ success: true, cached: true, data: lead });
    }

    let payload: any = {};
    try { payload = await request.json(); } catch { /* body optional */ }

    const result = await verifyOwnerName({
      addressStreet: l.addressStreet,
      addressZip: l.addressZip,
      owner1FirstName: l.owner1FirstName,
      owner1LastName: l.owner1LastName,
    });

    if (!result) {
      // Property isn't on the roll. Frank Aug-2026: WIP verify is mandatory and a
      // "not found" must be TRACKABLE for review — so we persist the outcome as
      // 'not_found' (rather than storing nothing) and surface it in QC. It is never a
      // 'mismatch' (that would wrongly imply a name disagreement).
      const detail = `No matching property found on the ${townLabel} tax roll for "${l.addressStreet}".`;
      await updateLead(id, {
        ownerVerifyStatus: 'not_found',
        ownerVerifySource: 'tax_roll',
        ownerVerifyAt: new Date(),
        ownerVerifyDetail: detail,
      });
      await addActivity(
        l.id,
        'owner_verify',
        `Owner name not found on ${townLabel} tax roll`,
        { status: 'not_found', source: 'tax_roll' },
        payload?._createdBy,
      );
      const updated = await getLeadByPropertyId(id);
      return NextResponse.json({ success: true, cached: false, result: { status: 'not_found', detail }, data: updated });
    }

    await updateLead(id, {
      ownerVerifyStatus: result.status,
      ownerVerifyName: result.recordName ?? undefined,
      ownerVerifySource: result.source,
      ownerVerifyAt: result.checkedAt,
      ownerVerifyDetail: result.detail,
    });

    await addActivity(
      l.id,
      'owner_verify',
      `Owner name ${result.status} vs ${result.source.replace(/_tax_roll$/, "").replace(/_/g, " ")} tax roll`
        + `${result.recordName ? ` — record shows "${result.recordName}"` : ''}`,
      { status: result.status, recordName: result.recordName, source: result.source },
      payload?._createdBy,
    );

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({ success: true, cached: false, result, data: updated });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/verify-owner error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Owner verification failed' },
      { status: 500 },
    );
  }
}
