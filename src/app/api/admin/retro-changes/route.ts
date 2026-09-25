import { NextRequest, NextResponse } from 'next/server';
import { getRetroChanges, buildDailyNotice, markNoticeSent, unsentNotices } from '@/services/retroChanges.service';

/**
 * Retroactive changes to worked accounts (Frank, 24 Sep 2026 · fix 21).
 *
 *   GET  ?day=YYYY-MM-DD   what changed that day, and whether Ruben was told
 *   GET  ?unsent=1         every day with changes that has not gone out
 *   POST { day, action: 'build' | 'sent', sentTo?, method? }
 *
 * Admin/superadmin only (enforced by middleware on /api/admin).
 *
 * The daily build also runs from the cron; this exists so a day can be inspected or
 * re-issued by hand, and so marking a notice as sent is a deliberate act by a named person
 * rather than something a background job claims on their behalf.
 */
export const dynamic = 'force-dynamic';

/** A date the database will accept, rejected here rather than interpolated hopefully. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    if (q.get('unsent')) {
      return NextResponse.json({ success: true, unsent: await unsentNotices(60) });
    }
    const day = q.get('day') || today();
    if (!DAY.test(day)) {
      return NextResponse.json({ success: false, error: 'day must be YYYY-MM-DD' }, { status: 400 });
    }
    const data = await getRetroChanges(day);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('GET /api/admin/retro-changes error:', error);
    return NextResponse.json({ success: false, error: 'Failed to read the day' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const day = String(body?.day || '');
    if (!DAY.test(day)) {
      return NextResponse.json({ success: false, error: 'day must be YYYY-MM-DD' }, { status: 400 });
    }

    if (body?.action === 'sent') {
      /**
       * Recorded against the person who says so.
       *
       * The point of the column is to answer "was Ruben told", and an unattributed yes
       * answers it no better than a blank. `_createdBy` is stamped by the admin middleware.
       */
      const r = await markNoticeSent(day, {
        sentTo: body?.sentTo ?? 'Ruben',
        sentBy: body?._createdBy ?? null,
        method: body?.method === 'email' || body?.method === 'in_app' ? body.method : 'manual',
      });
      return NextResponse.json({ success: true, ...r });
    }

    const built = await buildDailyNotice(day);
    return NextResponse.json({ success: true, ...built });
  } catch (error: any) {
    console.error('POST /api/admin/retro-changes error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed' },
      { status: 500 },
    );
  }
}
