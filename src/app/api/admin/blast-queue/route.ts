import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { queueForBlast, dequeueFromBlast, blastQueueSummary } from '@/services/blastQueue.service';

/**
 * The skip-trace blast queue.
 *
 *   GET    /api/admin/blast-queue                 what each queue holds
 *   POST   /api/admin/blast-queue                 { propertyIds, grade, reason }
 *   DELETE /api/admin/blast-queue                 { propertyIds }
 *
 * Under /api/admin so middleware restricts it to admin + superadmin. Queuing does not spend
 * a credit by itself, but it is the thing that decides what a blast will later spend
 * thousands on, and it isolates every lead it touches.
 */
export const dynamic = 'force-dynamic';

/**
 * A pull from the QC report can legitimately be a few thousand leads — the Grade-B roof
 * band is 2,681 today. The cap exists so a malformed body cannot queue the entire book in
 * one request, not to limit real work; it sits above the largest real selection.
 */
const MAX_PER_CALL = 10000;

export async function GET() {
  try {
    return NextResponse.json({ success: true, queues: await blastQueueSummary() });
  } catch (error) {
    console.error('GET /api/admin/blast-queue error:', error);
    return NextResponse.json({ success: false, error: 'Could not read the blast queue' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids: unknown = body?.propertyIds;
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ success: false, error: 'No leads were selected.' }, { status: 400 });
    }
    if (ids.length > MAX_PER_CALL) {
      return NextResponse.json(
        { success: false, error: `That is ${ids.length} leads; the most that can be queued at once is ${MAX_PER_CALL}.` },
        { status: 400 },
      );
    }
    /**
     * Anything but 'B' means 'A'. A malformed grade must not create a third queue that
     * nothing reads and no blast ever runs — leads would sit in it looking queued.
     */
    const grade = body?.grade === 'B' ? 'B' : 'A';
    const reason = String(body?.reason ?? '').trim().slice(0, 200) || 'queued from QC';

    const user = await getSessionUser(request);
    const result = await queueForBlast({
      propertyIds: ids.map(String),
      grade,
      actor: actorLabel(user),
      reason,
    });
    return NextResponse.json({ success: true, grade, ...result });
  } catch (error) {
    console.error('POST /api/admin/blast-queue error:', error);
    return NextResponse.json({ success: false, error: 'Could not queue those leads' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids: unknown = body?.propertyIds;
    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ success: false, error: 'No leads were selected.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, removed: await dequeueFromBlast(ids.map(String)) });
  } catch (error) {
    console.error('DELETE /api/admin/blast-queue error:', error);
    return NextResponse.json({ success: false, error: 'Could not remove those leads' }, { status: 500 });
  }
}
