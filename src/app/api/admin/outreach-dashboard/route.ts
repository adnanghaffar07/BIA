import { NextRequest, NextResponse } from 'next/server';
import { getOutreachDashboard } from '@/services/outreachDashboard.service';
import { getOutreachChannels } from '@/services/outreachChannels.service';
import { bandAccuracy, lossAnalysis } from '@/services/quoteOutcomes.service';

/**
 * GET /api/admin/outreach-dashboard?effFrom=&effTo=&scope=all&campaignId=&bandBy=
 *
 * With no range and no scope, the outreach programme window is applied. scope=all shows
 * every week ever loaded. An explicit range always wins over both.
 *
 * The Sec. 10.7 screen: Frank's funnel from Grade A at pull down to bound, plus the
 * guardrails that govern whether sending continues.
 *
 * Admin/superadmin only (enforced by middleware on /api/admin).
 */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const effFrom = p.get('effFrom') || undefined;
    const effTo = p.get('effTo') || undefined;
    const campaignId = p.get('campaignId') || undefined;
    /** Sec 10.9's cuts, passed straight through to the service that owns them. */
    const rawBy = p.get('bandBy');
    const bandBy = (['carrier', 'propertyType', 'municipality', 'cohort'] as const)
      .find((x) => x === rawBy) ?? 'carrier';

    const data = await getOutreachDashboard({
      effFrom,
      effTo,
      // scope=all means "every week", which is the absence of a range rather than a very
      // wide one — see the note on allWeeks in the service.
      allWeeks: p.get('scope') === 'all',
    });

    /**
     * The rest of Sec 10.7, fetched alongside rather than from separate calls the page
     * would have to keep in step. Band accuracy and loss analysis come from
     * quoteOutcomes.service — the same functions /api/admin/band-accuracy serves, so the
     * two screens cannot disagree.
     *
     * The channel sections take the range the DASHBOARD resolved, not the raw query. With
     * no range the dashboard defaults to the outreach programme window, and passing the
     * empty one here would put the funnels on a different set of weeks from the ladder
     * above them.
     */
    const [channels, accuracy, losses] = await Promise.all([
      getOutreachChannels({
        effFrom: data.range.from ?? undefined,
        effTo: data.range.to ?? undefined,
        campaignId,
      }),
      bandAccuracy(bandBy),
      lossAnalysis(),
    ]);

    return NextResponse.json({
      success: true,
      data: { ...data, channels, bandAccuracy: { by: bandBy, cuts: accuracy }, losses },
    });
  } catch (error) {
    console.error('GET /api/admin/outreach-dashboard error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to build the outreach dashboard' },
      { status: 500 },
    );
  }
}
