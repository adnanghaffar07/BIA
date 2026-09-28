import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import {
  createReminder, listReminders, closeReminder, reminderCounts,
} from '@/services/callReminder.service';

/**
 * Call reminders.
 *
 *   GET    /api/call-reminders?due=1&leadId=…   open reminders, soonest first
 *   POST   /api/call-reminders                  { leadId, phone?, minutes, note? }
 *   PATCH  /api/call-reminders                  { id, how: 'done' | 'dismissed' }
 *
 * NOT under /api/admin: a reminder is a producer's own note about their next call, and the
 * people who make the calls are not admins. Everything it exposes is already on the lead
 * pages they can open.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const [reminders, counts] = await Promise.all([
      listReminders({
        dueOnly: q.get('due') === '1',
        leadId: q.get('leadId') || undefined,
        // The phone screen asks for the closed ones too, so the panel is a record of the
        // shift rather than a list that empties itself as the work gets done.
        includeClosed: q.get('log') === '1',
        limit: Number(q.get('limit')) || undefined,
      }),
      reminderCounts(),
    ]);
    return NextResponse.json({ success: true, reminders, counts });
  } catch (error) {
    console.error('GET /api/call-reminders error:', error);
    return NextResponse.json({ success: false, error: 'Could not read the reminders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const leadId = String(body?.leadId ?? '').trim();
    if (!leadId) {
      return NextResponse.json({ success: false, error: 'No lead given.' }, { status: 400 });
    }

    const made = await createReminder({
      leadId,
      propertyId: body?.propertyId ? String(body.propertyId) : null,
      phone: body?.phone ? String(body.phone) : null,
      minutes: Number(body?.minutes),
      note: body?.note ? String(body.note).slice(0, 500) : null,
      createdBy: actorLabel(await getSessionUser(request)),
    });

    if (!made) {
      /**
       * The service refuses anything under a minute or beyond two weeks. Said plainly here,
       * because a reminder silently not created is one somebody waits for.
       */
      return NextResponse.json(
        { success: false, error: 'Give a number of minutes between 1 and 20160 (two weeks).' },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, reminder: made });
  } catch (error) {
    console.error('POST /api/call-reminders error:', error);
    return NextResponse.json({ success: false, error: 'Could not set that reminder' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id ?? '').trim();
    const how = body?.how === 'done' ? 'done' : 'dismissed';
    if (!id) return NextResponse.json({ success: false, error: 'No reminder given.' }, { status: 400 });

    const ok = await closeReminder(id, how, actorLabel(await getSessionUser(request)));
    // Not found OR already closed. Reported as a 404 either way: from the caller's side
    // "it is no longer open" is the same fact, and a second tap on a toast is normal.
    if (!ok) {
      return NextResponse.json({ success: false, error: 'That reminder is already closed.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, id, how });
  } catch (error) {
    console.error('PATCH /api/call-reminders error:', error);
    return NextResponse.json({ success: false, error: 'Could not close that reminder' }, { status: 500 });
  }
}
