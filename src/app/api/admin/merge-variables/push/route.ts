import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { previewGlobalsPush, pushGlobalsEverywhere } from '@/services/pushGlobals.service';

/**
 * GET  /api/admin/merge-variables/push          what a run would do, doing none of it
 * POST /api/admin/merge-variables/push?chunk=25 write the next batch
 *
 * The platform has no workspace-level variable — a merge field resolves from the contact and
 * nowhere else — so a shared value only exists where it has been written onto each contact.
 *
 * ── Why a batch and not one call ────────────────────────────────────────────
 * One PATCH per contact and each read back, because the platform answers 200 to a write that
 * stored nothing. Across the book that is ~1,500 calls, far past what a request should hold
 * open. Each POST does a bounded batch and reports what is left; the screen calls again until
 * nothing remains, so a closed laptop resumes rather than starting over.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await previewGlobalsPush()) });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not check' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!actorLabel(user)) {
      return NextResponse.json({ success: false, error: 'Sign in again.' }, { status: 401 });
    }
    /**
     * Bounded on the server as well as by the caller. A chunk size arriving from a browser is
     * a number somebody can type, and "write to every contact at once" is exactly the request
     * this endpoint is shaped to refuse.
     */
    const asked = Number(request.nextUrl.searchParams.get('chunk') ?? 25);
    const chunk = Math.max(1, Math.min(Number.isFinite(asked) ? asked : 25, 50));
    return NextResponse.json({ success: true, ...(await pushGlobalsEverywhere(chunk)) });
  } catch (err) {
    console.error('POST /api/admin/merge-variables/push error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not push them' },
      { status: 500 },
    );
  }
}
