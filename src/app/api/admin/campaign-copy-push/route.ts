import { NextRequest, NextResponse } from 'next/server';
import { planAllCampaigns, applyCampaignCopy } from '@/services/campaignCopyPush.service';

/**
 * GET  /api/admin/campaign-copy-push               what would change, every campaign. Read-only.
 * POST /api/admin/campaign-copy-push { campaignId }   apply it to ONE campaign.
 *
 * ── Why the path is -push and not /campaign-copy ────────────────────────────
 * /api/admin/campaign-copy already exists and serves the per-campaign copy AUDIT that the
 * campaign detail page renders. This was first written straight over it, and the page then
 * crashed with "Cannot read properties of undefined (reading 'filter')" — the audit shape it
 * expected had been replaced by a list of plans. Two different jobs, two paths.
 *
 * One campaign per POST deliberately. This replaces a live campaign's whole sequence, and a
 * single button that rewrote nine campaigns would make a mistake nine times before anybody
 * could look at the first.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const plans = await planAllCampaigns();
    return NextResponse.json({ success: true, plans });
  } catch (err) {
    console.error('GET /api/admin/campaign-copy-push error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not read the copy' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { campaignId } = await request.json();
    if (!campaignId) {
      return NextResponse.json({ success: false, error: 'Which campaign?' }, { status: 400 });
    }
    const res = await applyCampaignCopy(String(campaignId));
    return NextResponse.json({
      success: true,
      applied: res.applied,
      // False means the platform still reports pending changes after the write — a 200 from
      // this vendor has already been shown to mean nothing on its own.
      verified: res.verified,
    });
  } catch (err) {
    console.error('POST /api/admin/campaign-copy-push error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not apply' },
      { status: 500 },
    );
  }
}
