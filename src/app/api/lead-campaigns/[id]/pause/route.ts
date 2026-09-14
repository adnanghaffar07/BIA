import { NextRequest, NextResponse } from 'next/server';
import { pauseCampaign } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/** POST /api/lead-campaigns/[id]/pause — one action, one wrapper call. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const result = await pauseCampaign(id);
    return NextResponse.json({ success: true, action: 'pause', data: result ?? null });
  } catch (err) {
    return vendorError(err, 'Could not pause the campaign');
  }
}
