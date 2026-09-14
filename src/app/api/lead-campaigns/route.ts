import { NextRequest, NextResponse } from 'next/server';
import { listCampaigns, createCampaign } from '@/lib/integrations/leadCampaign';
import { CAMPAIGN_TIMEZONES, DEFAULT_CAMPAIGN_TIMEZONE } from '@/lib/integrations/campaignTimezones';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * GET /api/lead-campaigns — the LIGHT picker list: id, name, status, nothing else.
 *
 * Called every time a dropdown needs the campaign list, so it deliberately does not
 * fetch analytics. The heavier merged view lives at /overview; keeping them separate
 * means the common call never pays for the rare one.
 *
 * It doubles as the connection check — a 200 here means the key is valid and the
 * platform is reachable.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ success: true, connected: true, count: campaigns.length, data: campaigns });
  } catch (err) {
    return vendorError(err, 'Could not reach the campaign platform');
  }
}

/**
 * POST /api/lead-campaigns — create a campaign.
 *
 * Created paused, with one-click unsubscribe forced on and stop-on-reply set. The
 * platform requires a schedule with a timezone from its own curated list; sending an
 * ordinary IANA zone like America/New_York fails the create outright.
 */
export async function POST(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  let body: any = {};
  try { body = await request.json(); } catch { /* validated below */ }

  const name = String(body?.name ?? '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Give the campaign a name.' }, { status: 400 });
  }
  const timezone = String(body?.timezone ?? '').trim() || DEFAULT_CAMPAIGN_TIMEZONE;
  if (!CAMPAIGN_TIMEZONES.some((t) => t.value === timezone)) {
    return NextResponse.json(
      { error: 'That timezone is not one the campaign platform accepts.' },
      { status: 400 },
    );
  }

  try {
    const created = await createCampaign({
      name,
      timezone,
      from: body?.from,
      to: body?.to,
      days: body?.days,
      emailList: Array.isArray(body?.emailList) ? body.emailList : undefined,
      dailyLimit: body?.dailyLimit != null ? Number(body.dailyLimit) : undefined,
      subject: body?.subject,
      body: body?.body,
    });
    return NextResponse.json({ success: true, data: { id: created.id, name: created.name, status: created.status } });
  } catch (err) {
    return vendorError(err, 'Could not create the campaign');
  }
}
