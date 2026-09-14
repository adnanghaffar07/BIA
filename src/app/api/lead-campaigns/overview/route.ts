import { NextRequest, NextResponse } from 'next/server';
import { listCampaigns, getAllCampaignAnalytics, CAMPAIGN_STATUS } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * GET /api/lead-campaigns/overview — the dashboard view: every campaign with its
 * counters.
 *
 * Analytics for ALL campaigns comes back from one upstream call, so this is two
 * requests total regardless of how many campaigns exist — merged here by id rather
 * than fetched per campaign.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const [campaigns, analytics] = await Promise.all([listCampaigns(), getAllCampaignAnalytics()]);
    const byId = new Map(analytics.map((a) => [a.campaign_id, a]));

    const data = campaigns.map((c) => {
      const a = byId.get(c.id);
      const sent = a?.emails_sent_count ?? 0;
      // Rates are computed here so every surface reports them the same way. Percentages
      // are of emails SENT, not of leads — a lead that never got mailed should not drag
      // an open rate down.
      const rate = (n: number | undefined) => (sent > 0 ? Math.round(((n ?? 0) / sent) * 1000) / 10 : null);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        statusLabel: CAMPAIGN_STATUS[c.status] ?? `Status ${c.status}`,
        leads: a?.leads_count ?? 0,
        contacted: a?.contacted_count ?? 0,
        sent,
        opens: a?.open_count ?? 0,
        replies: a?.reply_count ?? 0,
        clicks: a?.link_click_count ?? 0,
        bounced: a?.bounced_count ?? 0,
        unsubscribed: a?.unsubscribed_count ?? 0,
        openRate: rate(a?.open_count),
        replyRate: rate(a?.reply_count),
        bounceRate: rate(a?.bounced_count),
      };
    });

    return NextResponse.json({ success: true, count: data.length, data });
  } catch (err) {
    return vendorError(err, 'Could not load campaign analytics');
  }
}
