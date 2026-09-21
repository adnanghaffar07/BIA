import { NextRequest, NextResponse } from 'next/server';
import { listThreads, sendReply, classifyReply } from '@/services/replies.service';
import { getSessionUser } from '@/lib/auth';
import { REPLY_CLASSES, type ReplyClass } from '@/lib/replyClasses';

/**
 * GET  /api/admin/replies            → every thread with at least one inbound message
 * POST /api/admin/replies            → { action: 'reply' | 'classify', ... }
 *
 * Admin/superadmin only (middleware on /api/admin).
 *
 * The threads are read live from the campaign platform rather than from a synced copy —
 * this is what a producer reads while a customer is waiting, and a sync lag on that is a
 * producer answering a message the customer has already followed up on.
 */

/** Reading a page of threads is several vendor calls; do not let the default 10s clip it. */
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit')) || undefined;
    // Scoped to one campaign when the campaign screen asks. Unscoped still works, so a
    // global inbox remains possible without changing this route.
    const raw = request.nextUrl.searchParams.get('campaignId');
    // The vendor rejects a non-uuid campaign_id with a 400, which would reach the screen
    // as a 500 rather than an empty inbox. Checked here so a bad URL is simply ignored.
    const campaignId = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
    const threads = await listThreads({ limit, campaignId });
    return NextResponse.json({
      success: true,
      count: threads.length,
      awaiting: threads.filter((t) => t.awaitingReply).length,
      data: threads,
    });
  } catch (error: unknown) {
    console.error('GET /api/admin/replies error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not read the inbox' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    const by = user?.email ?? null;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    // Everything below arrives from a browser, so each field is narrowed rather than
    // trusted. `str` returns null for anything that is not a non-empty string, which is
    // what the required-field checks test — a number or an object reads as absent.
    const str = (v: unknown): string | null =>
      (typeof v === 'string' && v.trim() ? v.trim() : null);

    if (body?.action === 'reply') {
      const replyToUuid = str(body.replyToUuid);
      const eaccount = str(body.eaccount);
      const text = str(body.text);
      if (!replyToUuid || !eaccount || !text) {
        return NextResponse.json(
          { success: false, error: 'A reply needs the message it answers, the mailbox and a body.' },
          { status: 400 },
        );
      }
      const sent = await sendReply({
        replyToUuid, eaccount, subject: str(body.subject) ?? '', text,
        leadId: str(body.leadId), contactEmail: str(body.contactEmail), by,
      });
      return NextResponse.json({ success: true, id: sent.id });
    }

    if (body?.action === 'classify') {
      const leadId = str(body.leadId);
      const contactEmail = str(body.contactEmail);
      const klass = str(body.klass);
      if (!leadId || !contactEmail || !klass) {
        return NextResponse.json(
          { success: false, error: 'Classifying needs the lead, the address and the class.' },
          { status: 400 },
        );
      }
      // Checked against the list rather than cast: an unknown class would otherwise be
      // written to the column and read back later as a category nothing can act on.
      if (!REPLY_CLASSES.some((c) => c.key === klass)) {
        return NextResponse.json(
          { success: false, error: `Unknown reply classification: ${klass}` },
          { status: 400 },
        );
      }
      const r = await classifyReply({
        leadId, contactEmail, klass: klass as ReplyClass, by,
      });
      return NextResponse.json({ success: true, ...r });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error: unknown) {
    console.error('POST /api/admin/replies error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Action failed' },
      { status: 500 },
    );
  }
}
