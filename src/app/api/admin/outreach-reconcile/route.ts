import { NextRequest, NextResponse } from 'next/server';
import { reconcileOutreach, summarise } from '@/services/outreachReconcile.service';

/**
 * Make the sending platform agree with the CRM about who has stopped.
 *
 *   GET  /api/admin/outreach-reconcile[?campaignId=]   DRY RUN — what is out of step.
 *   POST /api/admin/outreach-reconcile[?campaignId=]   Correct it.
 *
 * Under /api/admin so the middleware restricts it to admin and superadmin: a POST here
 * removes recipients from a live campaign, which is not a producer-level action.
 *
 * The same work runs unattended every fifteen minutes via /api/cron/outreach-reconcile.
 * This route exists for the two cases the schedule does not cover — checking what the
 * next sweep would do before it does it, and forcing one immediately after a stop that
 * reported a platform failure.
 *
 * GET is free and changes nothing, so it is safe to poll while watching a campaign.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const campaignId = req.nextUrl.searchParams.get('campaignId')?.trim() || undefined;
    const result = await reconcileOutreach({ dryRun: true, campaignId });
    return NextResponse.json({ success: true, summary: summarise(result), ...result });
  } catch (err: any) {
    console.error('GET /api/admin/outreach-reconcile error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not read the campaigns' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const campaignId = req.nextUrl.searchParams.get('campaignId')?.trim() || undefined;
    const result = await reconcileOutreach({ dryRun: false, campaignId });
    console.log('[reconcile]', summarise(result));
    return NextResponse.json({ success: true, summary: summarise(result), ...result });
  } catch (err: any) {
    console.error('POST /api/admin/outreach-reconcile error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Reconcile failed' },
      { status: 500 },
    );
  }
}
