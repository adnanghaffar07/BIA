import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignOverview, getCampaignDaily, getCampaignStepStats, getCampaign,
} from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * One campaign's analytics: headline counters, a daily series, and per-step results.
 *
 * Three vendor calls in parallel rather than three routes, because the panel needs all
 * of them at once and they are independent.
 *
 * Rates are computed HERE rather than in the component so that "opened" means the same
 * thing everywhere: unique openers over emails sent. Total opens divided by sends is
 * the number that flatters a campaign — one recipient opening six times is not a 600%
 * open rate — so the unique figure is the only one a rate is built from.
 */

export const maxDuration = 10;

/** Whether the numbers can be believed at all, which depends on the campaign's own settings. */
type Caveat = 'open-tracking-off' | 'link-tracking-off';

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const { id } = await params;
    const url = new URL(request.url);
    const start = url.searchParams.get('start') || undefined;
    const end = url.searchParams.get('end') || undefined;

    const [overview, daily, steps, campaign] = await Promise.all([
      getCampaignOverview(id, { start, end }),
      getCampaignDaily(id, { start, end }),
      getCampaignStepStats(id),
      getCampaign(id),
    ]);

    const sent = overview.emails_sent_count ?? 0;
    const uniqueOpens = overview.open_count_unique ?? 0;
    const uniqueReplies = overview.reply_count_unique ?? 0;
    const uniqueClicks = overview.link_click_count_unique ?? 0;
    const bounced = overview.bounced_count ?? 0;

    // A rate against a campaign that has not sent is not "0%", it is unknown. Saying
    // 0% about zero sends reads as "nobody opened it", which is a different claim.
    const caveats: Caveat[] = [];
    if (!campaign.open_tracking) caveats.push('open-tracking-off');
    if (!campaign.link_tracking) caveats.push('link-tracking-off');

    return NextResponse.json({
      success: true,
      totals: {
        sent,
        contacted: overview.contacted_count ?? 0,
        opens: overview.open_count ?? 0,
        uniqueOpens,
        clicks: overview.link_click_count ?? 0,
        uniqueClicks,
        replies: overview.reply_count ?? 0,
        uniqueReplies,
        bounced,
        unsubscribed: overview.unsubscribed_count ?? 0,
        completed: overview.completed_count ?? 0,
        opportunities: overview.total_opportunities ?? 0,
      },
      rates: {
        open: pct(uniqueOpens, sent),
        click: pct(uniqueClicks, sent),
        reply: pct(uniqueReplies, sent),
        bounce: pct(bounced, sent),
      },
      daily: daily.map((d) => ({
        date: d.date,
        sent: d.sent ?? 0,
        opened: d.unique_opened ?? 0,
        replies: d.unique_replies ?? 0,
        clicks: d.unique_clicks ?? 0,
      })),
      steps: steps.map((s) => {
        const stepSent = s.sent ?? 0;
        return {
          step: Number(s.step) + 1,
          variant: s.variant,
          sent: stepSent,
          opened: s.unique_opened ?? 0,
          replies: s.unique_replies ?? 0,
          clicks: s.unique_clicks ?? 0,
          openRate: pct(s.unique_opened ?? 0, stepSent),
          replyRate: pct(s.unique_replies ?? 0, stepSent),
        };
      }),
      caveats,
    });
  } catch (err) {
    return vendorError(err, 'Could not load the campaign analytics');
  }
}
