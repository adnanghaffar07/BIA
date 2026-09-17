import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { verifyOwnerName, WIPP_BY_ZIP } from '@/services/taxRoll.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

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

    /**
     * Cached result wins unless the caller forces a re-check — EXCEPT 'unavailable',
     * which is never a result. It records that the roll could not be reached, and caching
     * it would freeze a transient outage into a permanent non-answer that only a manual
     * ?force=1 could ever clear.
     */
    const force = request.nextUrl.searchParams.get('force') === '1';
    if (l.ownerVerifyStatus && l.ownerVerifyStatus !== 'unavailable' && !force) {
      return NextResponse.json({ success: true, cached: true, data: lead });
    }

    let payload: any = {};
    try { payload = await request.json(); } catch { /* body optional */ }
    // Attribution comes from the session, not the client (Frank Aug-2026).
    const actor = actorLabel(await getSessionUser(request)) ?? payload?._createdBy ?? null;

    const result = await verifyOwnerName({
      addressStreet: l.addressStreet,
      addressZip: l.addressZip,
      owner1FirstName: l.owner1FirstName,
      owner1LastName: l.owner1LastName,
    });

    /**
     * No name comparison happened. Three different reasons, and they must not be written
     * down as the same thing:
     *
     *   not_found    every roll answered and none holds this address. A real fact about
     *                the property — overwhelmingly condos, which municipal rolls list by
     *                lot and qualifier rather than street address.
     *   unavailable  a roll could not be reached. NOT a fact about the property. Recorded
     *                so it is visible and retried, never cached as an answer.
     *   unsupported  no roll is configured for this ZIP. Also not a fact about the
     *                property.
     *
     * Until now all three collapsed into 'not_found', so an outage would have written
     * "this property is not on the tax roll" across every lead it touched — permanently,
     * and indistinguishably from the genuine misses.
     */
    if (!('recordName' in result)) {
      const status = result.status;
      const detail = status === 'not_found'
        ? `No matching property found on the ${townLabel} tax roll for "${l.addressStreet}".`
        : result.detail;

      await updateLead(id, {
        ownerVerifyStatus: status,
        ownerVerifySource: status === 'not_found' ? 'tax_roll' : `tax_roll_${status}`,
        ownerVerifyAt: new Date(),
        ownerVerifyDetail: detail,
      });
      await addActivity(
        l.id,
        'owner_verify',
        status === 'not_found'
          ? `Owner name not found on ${townLabel} tax roll`
          : `Tax-roll check could not complete (${status}) for ${townLabel}`,
        { status, source: 'tax_roll' },
        actor,
      );
      const updated = await getLeadByPropertyId(id);
      return NextResponse.json({
        success: true,
        cached: false,
        // An unreachable roll is not a verification result, and a caller that treats a
        // 200 as "checked" would be wrong. Say so explicitly.
        checked: status === 'not_found',
        result: { status, detail },
        data: updated,
      });
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
      actor,
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
