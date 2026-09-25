import { NextRequest, NextResponse } from 'next/server';
import { sendPreflight } from '@/services/sendPreflight.service';

/**
 * GET /api/admin/send-preflight?effFrom&effTo
 *
 * What the frozen send list promises, against what the push would actually do.
 *
 * Admin/superadmin only (enforced by middleware on /api/admin). Read-only — it changes
 * nothing, because every disagreement it finds is a decision about what we told Frank rather
 * than a fault to patch.
 */
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    // The wave-one window. Defaulted rather than required: the question "is the send list
    // sound" is almost always about this range, and making it mandatory would mean the
    // first person to check it has to look the dates up first.
    const effFrom = q.get('effFrom') || '2026-10-05';
    const effTo = q.get('effTo') || '2026-11-16';
    if (!DAY.test(effFrom) || !DAY.test(effTo)) {
      return NextResponse.json(
        { success: false, error: 'effFrom and effTo must be YYYY-MM-DD' },
        { status: 400 },
      );
    }
    const data = await sendPreflight({ effFrom, effTo });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('GET /api/admin/send-preflight error:', error);
    return NextResponse.json({ success: false, error: 'Preflight failed' }, { status: 500 });
  }
}
