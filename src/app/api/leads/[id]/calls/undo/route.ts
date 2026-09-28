import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/neon';
import { getSessionUser } from '@/lib/auth';
import { undoLastAttempt, callState } from '@/services/callLog.service';

/**
 * POST /api/leads/{id}/calls/undo
 *
 * Take back the last call outcome (Frank, 25 Sep 2026 · item 9).
 *
 * Its own route rather than a DELETE on the attempt: whoever has just mis-tapped does not
 * know the attempt's id — what they know is "that last one was wrong". Making the panel look
 * one up first would put a round trip between the mistake and the correction, and the whole
 * value of this is that it happens in the five seconds somebody notices.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser(req);

    const [lead] = await sql`
      SELECT * FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1` as Array<Record<string, unknown>>;
    if (!lead) return NextResponse.json({ success: false, error: 'No such lead' }, { status: 404 });

    const r = await undoLastAttempt({ lead, by: user?.email ?? null });
    if (!r.undone) {
      /**
       * A refusal is a normal answer here — nothing to undo, or past the window. 200 with
       * the reason, so the panel prints the sentence rather than a generic failure to
       * somebody who is mid-call.
       */
      return NextResponse.json({ success: true, undone: false, reason: r.reason });
    }

    const [fresh] = await sql`
      SELECT * FROM "Lead" WHERE "id" = ${String(lead.id)}` as Array<Record<string, unknown>>;
    return NextResponse.json({
      success: true, undone: true, outcome: r.outcome,
      data: await callState(fresh ?? lead),
    });
  } catch (error: unknown) {
    console.error('POST /api/leads/[id]/calls/undo error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not undo that' },
      { status: 500 },
    );
  }
}
