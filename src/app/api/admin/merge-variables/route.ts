import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import {
  listGlobalMergeVars, upsertGlobalMergeVar, deleteGlobalMergeVar, nameProblem,
} from '@/services/globalMergeVars.service';

/**
 * Merge variables whose value is the same for every homeowner (migration 047).
 *
 *   GET    /api/admin/merge-variables
 *   POST   /api/admin/merge-variables   { name, value, description }
 *   DELETE /api/admin/merge-variables?name=…
 *
 * ── Why a write carries a name ──────────────────────────────────────────────
 * One value here goes into every email of every campaign that mentions it. That is a larger
 * blast radius than most things somebody types into this CRM, and the row records who set it
 * so a wrong website in ten thousand sends has an author rather than a mystery.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, variables: await listGlobalMergeVars() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not load them' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    const who = actorLabel(user);
    if (!who) {
      return NextResponse.json(
        { success: false, error: 'Sign in again — a variable is recorded against your name.' },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    const value = String(body?.value ?? '');
    const description = typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim().slice(0, 300)
      : null;

    /**
     * The name is checked here as well as in the service. A bad name is the one mistake that
     * cannot be seen afterwards: it sits in the table looking correct and silently matches
     * nothing in any template, for as long as nobody reads an email.
     */
    const problem = nameProblem(name);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

    const r = await upsertGlobalMergeVar({ name, value, description, by: who });
    if (!r.ok) return NextResponse.json({ success: false, error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, variables: await listGlobalMergeVars() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save that' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getSessionUser(request);
    if (!actorLabel(user)) {
      return NextResponse.json({ success: false, error: 'Sign in again.' }, { status: 401 });
    }
    const name = request.nextUrl.searchParams.get('name');
    if (!name) return NextResponse.json({ success: false, error: 'No name given.' }, { status: 400 });
    await deleteGlobalMergeVar(name);
    return NextResponse.json({ success: true, variables: await listGlobalMergeVars() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not remove that' },
      { status: 500 },
    );
  }
}
