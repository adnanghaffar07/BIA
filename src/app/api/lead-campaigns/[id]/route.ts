import { NextRequest, NextResponse } from 'next/server';
import { getCampaign, patchCampaign, deleteCampaign, CAMPAIGN_STATUS } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * One campaign: read, rename/reconfigure, delete.
 *
 * Each verb re-checks access itself. Campaign ids are guessable strings and the
 * platform applies none of our roles, so a sub-route must never assume the list
 * endpoint already filtered for the caller.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(_request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const c = await getCampaign(id);
    const step = c.sequences?.[0]?.steps?.[0];
    return NextResponse.json({
      success: true,
      data: {
        id: c.id,
        name: c.name,
        status: c.status,
        statusLabel: CAMPAIGN_STATUS[c.status] ?? `Status ${c.status}`,
        dailyLimit: c.daily_limit ?? null,
        stopOnReply: c.stop_on_reply ?? null,
        unsubscribeHeader: c.insert_unsubscribe_header ?? null,
        linkTracking: c.link_tracking ?? null,
        openTracking: c.open_tracking ?? null,
        mailboxes: c.email_list ?? [],
        steps: (c.sequences?.[0]?.steps ?? []).length,
        firstSubject: step?.variants?.[0]?.subject ?? null,
        firstBody: step?.variants?.[0]?.body ?? null,
      },
    });
  } catch (err) {
    return vendorError(err, 'Could not load the campaign');
  }
}

/** Rename or change options. Only the keys present are sent upstream. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (body?.dailyLimit != null) patch.daily_limit = Number(body.dailyLimit);
    if (typeof body?.stopOnReply === 'boolean') patch.stop_on_reply = body.stopOnReply;
    if (typeof body?.unsubscribeHeader === 'boolean') patch.insert_unsubscribe_header = body.unsubscribeHeader;
    if (typeof body?.openTracking === 'boolean') patch.open_tracking = body.openTracking;
    if (typeof body?.linkTracking === 'boolean') patch.link_tracking = body.linkTracking;
    if (Array.isArray(body?.mailboxes)) patch.email_list = body.mailboxes;

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
    }
    const updated = await patchCampaign(id, patch);
    return NextResponse.json({ success: true, data: { id: updated.id, name: updated.name, status: updated.status } });
  } catch (err) {
    return vendorError(err, 'Could not update the campaign');
  }
}

/**
 * Delete a campaign on the platform.
 *
 * Irreversible and it takes the campaign's leads and history with it, so the caller
 * must pass the campaign's exact name as confirmation — the same guard a human would
 * expect before a destructive action, enforced server-side rather than trusted to the
 * dialog that called it.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const current = await getCampaign(id);
    if (String(body?.confirmName ?? '').trim() !== current.name) {
      return NextResponse.json(
        { error: `Type the campaign name exactly ("${current.name}") to confirm deletion.` },
        { status: 400 },
      );
    }
    await deleteCampaign(id);
    return NextResponse.json({ success: true, deleted: current.name });
  } catch (err) {
    return vendorError(err, 'Could not delete the campaign');
  }
}
