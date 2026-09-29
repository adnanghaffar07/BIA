import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowBoard } from '@/services/workflowBoard.service';

/**
 * GET /api/admin/workflow?effFrom=&effTo=
 *
 * What is outstanding, by renewal week (Frank, 29 Sep 2026).
 *
 * Read-only and entirely derived — there is nothing to POST, because nothing on this board
 * is a task anybody closes by hand. An item exists while the lead says work is owed and
 * stops existing when that changes, so the only way to clear the board is to do the work.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const effFrom = request.nextUrl.searchParams.get('effFrom') || undefined;
    const effTo = request.nextUrl.searchParams.get('effTo') || undefined;
    const board = await getWorkflowBoard({ effFrom, effTo });
    return NextResponse.json({ success: true, ...board });
  } catch (err) {
    console.error('GET /api/admin/workflow error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not build the board' },
      { status: 500 },
    );
  }
}
