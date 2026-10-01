import { NextRequest, NextResponse } from 'next/server';
import {
  getSubjects, setSubject, setSubjectRouting, createSubject, deleteSubject, subjectCoverage,
  type Routing,
} from '@/services/campaignSubject.service';
import { getSessionUser, actorLabel } from '@/lib/auth';

/**
 * GET    /api/admin/subjects            every line, plus a coverage check
 * POST   /api/admin/subjects            create one  { routing, name, template }
 * PATCH  /api/admin/subjects            edit one    { id, name?, template?, routing? }
 * DELETE /api/admin/subjects?id=…       remove one
 *
 * Zoya decides which line goes to which email, variant and cohort — so the routing is as
 * editable as the words. Both the overlap check and the coverage check live in the service,
 * not here, so the API cannot store an arrangement the screen would have refused.
 */
export const dynamic = 'force-dynamic';

const routingFrom = (b: Record<string, unknown>): Routing => ({
  segment: String(b?.segment ?? 'rated') as Routing['segment'],
  step: Number(b?.step ?? 1),
  variant: String(b?.variant ?? 'A') === 'B' ? 'B' : 'A',
  cohorts: Array.isArray(b?.cohorts) ? (b.cohorts as string[]).map(String) : [],
});

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
    const res = await createSubject(
      routingFrom(body?.routing ?? {}),
      String(body?.name ?? ''),
      String(body?.template ?? ''),
      by,
    );
    if (!res.ok) return NextResponse.json({ success: false, problems: res.problems }, { status: 400 });
    return NextResponse.json({ success: true, subjects: await getSubjects(), coverage: await subjectCoverage() });
  } catch (err) {
    console.error('POST /api/admin/subjects error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const by = actorLabel(await getSessionUser(request));
    const id = String(body?.id ?? '');
    if (!id) return NextResponse.json({ success: false, error: 'Which line?' }, { status: 400 });

    /**
     * Routing first. If the words save and the routing is refused, the screen has stored
     * half an edit and the person has no way to tell which half.
     */
    if (body?.routing) {
      const r = await setSubjectRouting(id, routingFrom(body.routing));
      if (!r.ok) return NextResponse.json({ success: false, problems: r.problems }, { status: 400 });
    }
    if (body?.name != null || body?.template != null) {
      const r = await setSubject(id, String(body?.name ?? ''), String(body?.template ?? ''), by);
      if (!r.ok) return NextResponse.json({ success: false, problems: r.problems }, { status: 400 });
    }
    return NextResponse.json({ success: true, subjects: await getSubjects(), coverage: await subjectCoverage() });
  } catch (err) {
    console.error('PATCH /api/admin/subjects error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Which line?' }, { status: 400 });
    const res = await deleteSubject(id);
    return NextResponse.json({
      success: true,
      // The audiences this delete left with no line of their own — shown, not blocked.
      stranded: res.stranded,
      subjects: await getSubjects(),
      coverage: await subjectCoverage(),
    });
  } catch (err) {
    console.error('DELETE /api/admin/subjects error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not delete' },
      { status: 500 },
    );
  }
}
