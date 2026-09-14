import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { isConfigured } from '@/lib/integrations/leadCampaign';

/**
 * Access control for the Lead Campaigns module.
 *
 * This module lives at /api/lead-campaigns rather than under /api/admin, so the
 * middleware's admin gate does not apply to it and every route must check for
 * itself. That is deliberate on both counts: the module is self-contained, and a
 * route that guards itself cannot be left open by someone editing a path list
 * somewhere else.
 *
 * Campaign actions send mail from the agency's own warmed domains. A bad send costs
 * sender reputation, which is slow and expensive to rebuild, so this is an admin and
 * superadmin capability rather than a producer one.
 */

export type CampaignActor = { email: string | null; role: string };

/**
 * Returns the acting user, or a ready-to-return error response.
 *
 * Callers do:  const gate = await requireCampaignAccess(req);
 *              if ('response' in gate) return gate.response;
 */
export async function requireCampaignAccess(
  request: NextRequest,
): Promise<{ actor: CampaignActor } | { response: NextResponse }> {
  const user = await getSessionUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return {
      response: NextResponse.json(
        { error: 'Lead campaigns are managed by an admin. Ask your manager for access.' },
        { status: 403 },
      ),
    };
  }
  if (!isConfigured()) {
    // A missing key is an operator problem, not a bug — say so plainly rather than
    // letting the first vendor call throw an unhelpful error.
    return {
      response: NextResponse.json(
        { error: 'The campaign platform is not connected yet. Add the API key and try again.' },
        { status: 503 },
      ),
    };
  }
  return { actor: { email: actorLabel(user), role: user.role } };
}

/**
 * Map a thrown vendor error to a response.
 *
 * Anything the wrapper throws is an upstream failure, so it becomes a 502 — the CRM
 * itself is fine. The message is already de-branded by the wrapper and safe to show.
 */
export function vendorError(err: unknown, fallback: string): NextResponse {
  const message = (err as Error)?.message || fallback;
  console.error('[lead-campaigns]', message);
  return NextResponse.json({ error: message }, { status: 502 });
}
