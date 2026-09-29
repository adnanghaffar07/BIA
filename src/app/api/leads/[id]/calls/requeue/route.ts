import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/neon';
import { getSessionUser } from '@/lib/auth';
import { returnToQueue, callState } from '@/services/callLog.service';

/**
 * POST /api/leads/{id}/calls/requeue
 *
 * Put a lead back in the calling queue (Frank, 29 Sep 2026).
 *
 * "What's the best thing to get it back in the queue? I want it back in the regular queue...
 * I can't do undo." The undo is deliberately ten minutes and deliberately destructive; this
 * is the other thing, for when a real call happened and the lead still needs to be worked
 * again — a test row, a mis-set status, a card somebody closed out too early.
 *
 * ── Why the actor comes from the session ────────────────────────────────────
 * This moves a lead back into a producer's working queue and sets aside calls that were
 * really made. It is a correction, and the point of a correction over a deletion is that
 * somebody's name is on it. The body supplies the reason; it never supplies the person.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser(req);
    if (!user?.email) {
      return NextResponse.json(
        { success: false, error: 'Sign in again — a return to the queue is recorded against your name.' },
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : null;

    const [lead] = await sql`
      SELECT * FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1` as Array<Record<string, unknown>>;
    if (!lead) return NextResponse.json({ success: false, error: 'No such lead' }, { status: 404 });

    const r = await returnToQueue({ lead, by: user.email, reason });
    if (!r.returned) {
      /**
       * A refusal is a normal answer — nothing to set aside, or the household is suppressed
       * and that must be lifted deliberately rather than as a side effect of tidying a
       * queue. 200 with the sentence, so the card prints the reason instead of an error.
       */
      return NextResponse.json({ success: true, returned: false, reason: r.reason });
    }

    const [fresh] = await sql`
      SELECT * FROM "Lead" WHERE "id" = ${String(lead.id)}` as Array<Record<string, unknown>>;
    return NextResponse.json({
      success: true,
      returned: true,
      discounted: r.discounted,
      restoredNumbers: r.restoredNumbers,
      data: await callState(fresh ?? lead),
    });
  } catch (error: unknown) {
    console.error('POST /api/leads/[id]/calls/requeue error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not return that lead to the queue' },
      { status: 500 },
    );
  }
}
