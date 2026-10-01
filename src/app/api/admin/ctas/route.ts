import { NextRequest, NextResponse } from 'next/server';
import { getCtas, setCta } from '@/services/campaignCta.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

/**
 * GET  /api/admin/ctas        the three asks
 * POST /api/admin/ctas        { step, label, wording }
 *
 * The validation lives in the service, not here, so a value cannot be stored by calling
 * the API directly that the screen would have refused.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ctas: await getCtas() });
  } catch (err) {
    console.error('GET /api/admin/ctas error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not read the asks' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const by = actorLabel(await getSessionUser(request));
    const res = await setCta(
      Number(body?.step),
      String(body?.label ?? ''),
      String(body?.wording ?? ''),
      by,
    );
    if (!res.ok) {
      return NextResponse.json({ success: false, problems: res.problems }, { status: 400 });
    }
    return NextResponse.json({ success: true, ctas: await getCtas() });
  } catch (err) {
    console.error('POST /api/admin/ctas error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save' },
      { status: 500 },
    );
  }
}
