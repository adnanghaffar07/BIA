import { NextRequest, NextResponse } from 'next/server';
import { listCampaigns, getAllCampaignAnalytics, getLeadCountsByCampaign, CAMPAIGN_STATUS } from '@/lib/integrations/leadCampaign';
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
    // Three calls, not N+1: the campaign list, one analytics call covering every
    // campaign, and one pass over the workspace's leads grouped by campaign.
    const [campaigns, analytics, leadCounts] = await Promise.all([
      listCampaigns(),
      getAllCampaignAnalytics(),
      getLeadCountsByCampaign(),
    ]);
    const byId = new Map(analytics.map((a) => [a.campaign_id, a]));

    const data = campaigns.map((c) => {
      const a = byId.get(c.id);
      const sent = a?.emails_sent_count ?? 0;
      // Rates are computed here so every surface reports them the same way. Percentages
      // are of emails SENT, not of leads — a lead that never got mailed should not drag
      // an open rate down.
      const rate = (n: number | undefined) => (sent > 0 ? Math.round(((n ?? 0) / sent) * 1000) / 10 : null);
      // Lead count comes from the real lead list, NOT analytics. Analytics omits
      // campaigns with no send activity altogether, so a draft holding 300 leads
      // used to read "0 leads" — indistinguishable from a failed import. Analytics
      // still owns the engagement counters, which it is the only source for.
      const counted = leadCounts.counts.get(c.id) ?? 0;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        statusLabel: CAMPAIGN_STATUS[c.status] ?? `Status ${c.status}`,
        leads: Math.max(counted, a?.leads_count ?? 0),
        leadsTruncated: leadCounts.truncated,
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
