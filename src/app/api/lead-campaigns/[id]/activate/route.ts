import { NextRequest, NextResponse } from 'next/server';
import { activateCampaign } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/** POST /api/lead-campaigns/[id]/activate — one action, one wrapper call. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const result = await activateCampaign(id);
    return NextResponse.json({ success: true, action: 'activate', data: result ?? null });
  } catch (err) {
    return vendorError(err, 'Could not activate the campaign');
  }
}
