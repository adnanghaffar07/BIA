import { NextRequest, NextResponse } from 'next/server';
import { getSubjects, setSubject, subjectCoverage } from '@/services/campaignSubject.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

/**
 * GET  /api/admin/subjects   every stored line, plus a coverage check
 * POST /api/admin/subjects   { id, name, template }
 *
 * The coverage check rides along with the GET rather than living on its own screen. If an
 * audience has no stored line the fallback serves the compiled wording silently, so an edit
 * appears to do nothing for that audience — the failure is invisible exactly where somebody
 * is looking at the thing they just edited.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [subjects, coverage] = await Promise.all([getSubjects(), subjectCoverage()]);
    return NextResponse.json({ success: true, subjects, coverage });
  } catch (err) {
    console.error('GET /api/admin/subjects error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not read the subjects' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const by = actorLabel(await getSessionUser(request));
    const res = await setSubject(String(body?.id ?? ''), String(body?.name ?? ''), String(body?.template ?? ''), by);
    if (!res.ok) return NextResponse.json({ success: false, problems: res.problems }, { status: 400 });
    return NextResponse.json({ success: true, subjects: await getSubjects() });
  } catch (err) {
    console.error('POST /api/admin/subjects error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save' },
      { status: 500 },
    );
  }
}
