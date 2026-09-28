import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/neon';
import { getSessionUser } from '@/lib/auth';
import { captureEmails } from '@/services/captureEmail.service';
import { callState } from '@/services/callLog.service';

/**
 * POST /api/leads/{id}/capture-email
 *   { insuredEmail?, coInsuredEmail? }
 *
 * An address the homeowner gave on the phone (Frank, 25 Sep 2026 · item 8).
 *
 * Its own route rather than part of the card's general save: this is taken mid-call, by
 * whoever is on the phone, and it has to be one action they can complete in seconds. Folding
 * it into the card form would mean loading and re-saving the whole lead to record one line
 * somebody just read out.
 *
 * Returns the refreshed call state, so the panel can show the lead becoming reachable
 * without a second request.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const str = (v: unknown): string | null =>
      (typeof v === 'string' && v.trim() ? v.trim() : null);

    const [lead] = await sql`SELECT * FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1` as Array<Record<string, unknown>>;
    if (!lead) {
      return NextResponse.json({ success: false, error: 'No such lead' }, { status: 404 });
    }

    const result = await captureEmails({
      lead,
      insuredEmail: str(body.insuredEmail),
      coInsuredEmail: str(body.coInsuredEmail),
      by: user?.email ?? null,
    });

    /** Re-read, so the state returned reflects the address that was just added. */
    const [fresh] = await sql`SELECT * FROM "Lead" WHERE "id" = ${String(lead.id)}` as Array<Record<string, unknown>>;
    return NextResponse.json({
      success: true,
      ...result,
      data: await callState(fresh ?? lead),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not save that address';
    /**
     * A rejected address is the caller's mistake to fix, not a server fault — 400 so the
     * panel shows the reason rather than a generic failure while somebody is on the phone.
     */
    console.error('POST /api/leads/[id]/capture-email error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
