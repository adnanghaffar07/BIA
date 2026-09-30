import { NextRequest, NextResponse } from 'next/server';
import { auditCampaignCopy, resyncCampaignVariables } from '@/services/campaignCopy.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

/**
 * GET /api/admin/campaign-copy?campaignId=…
 *
 * What the live sequence copy asks for, against what the CRM actually sends.
 *
 * Read-only on both sides — it fetches the sequence and one contact and writes nothing, so
 * running it against a live campaign is safe.
 */
export const dynamic = 'force-dynamic';

/**
 * POST — push the current values onto the contacts already in the campaign.
 *
 * custom_variables are written when a contact is created and never again, so a value set
 * after an upload never reaches the people already standing in the campaign. Everything on
 * screen then looks correct and the email still sends a blank.
 *
 * ── Why this is a button and not a script ───────────────────────────────────
 * There is a script that does it, and it has only ever been run by a developer. The person
 * who notices the problem is whoever is looking at the copy check, and asking them to find
 * somebody with a terminal is how a five-second fix waits a day.
 *
 * Only contacts already in the campaign are touched, only their variables change, and each
 * write is read back — the platform answers 200 to a PATCH that stored nothing, so the
 * response is not evidence.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!actorLabel(user)) {
      return NextResponse.json({ success: false, error: 'Sign in again.' }, { status: 401 });
    }
    const campaignId = request.nextUrl.searchParams.get('campaignId');
    if (!campaignId) {
      return NextResponse.json({ success: false, error: 'No campaign given.' }, { status: 400 });
    }
    const r = await resyncCampaignVariables(campaignId);
    return NextResponse.json({ success: true, ...r, ...(await auditCampaignCopy(campaignId)) });
  } catch (err) {
    console.error('POST /api/admin/campaign-copy error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not re-sync' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const campaignId = request.nextUrl.searchParams.get('campaignId');
    if (!campaignId) {
      return NextResponse.json({ success: false, error: 'No campaign given.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...(await auditCampaignCopy(campaignId)) });
  } catch (err) {
    console.error('GET /api/admin/campaign-copy error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not read the copy' },
      { status: 500 },
    );
  }
}
