import { NextRequest, NextResponse } from 'next/server';
import { duplicateCampaign } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/** POST /api/lead-campaigns/[id]/duplicate — one action, one wrapper call. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const result = await duplicateCampaign(id);
    return NextResponse.json({ success: true, action: 'duplicate', data: result ?? null });
  } catch (err) {
    return vendorError(err, 'Could not duplicate the campaign');
  }
}
