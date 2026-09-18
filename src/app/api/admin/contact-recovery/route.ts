import { NextRequest, NextResponse } from 'next/server';
import { findRecoveryCandidates, recoverContacts } from '@/services/contactRecovery.service';

/**
 * GET  /api/admin/contact-recovery            → the candidate list (no vendor calls)
 * POST /api/admin/contact-recovery            → run it
 *        body: { dryRun?: boolean, limit?: number, liftOverrides?: boolean }
 *
 * Admin/superadmin only (enforced by middleware on /api/admin).
 *
 * POST defaults to dryRun TRUE and a limit of 25. Both defaults are deliberate: every
 * call costs money, and the previous mass operation run without a preview is still being
 * unpicked. A caller has to ask for a live run, and has to ask again to go past 25.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const candidates = await findRecoveryCandidates({
      effFrom: q.get('effFrom') || undefined,
      effTo: q.get('effTo') || undefined,
    });
    return NextResponse.json({
      success: true,
      count: candidates.length,
      missingEmail: candidates.filter((c) => !c.hasInsuredEmail).length,
      missingPhone: candidates.filter((c) => !c.hasInsuredPhone).length,
      missingDob: candidates.filter((c) => !c.hasDob).length,
      underOverride: candidates.filter((c) => c.manualGrade).length,
      data: candidates.slice(0, 200),
    });
  } catch (error) {
    console.error('GET /api/admin/contact-recovery error:', error);
    return NextResponse.json({ success: false, error: 'Failed to list candidates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 200);
    const result = await recoverContacts({
      dryRun: body?.dryRun !== false,
      limit,
      liftOverrides: body?.liftOverrides === true,
      createdBy: body?._createdBy ?? null,
      // The run covers exactly what the screen that launched it was showing.
      effFrom: body?.effFrom || undefined,
      effTo: body?.effTo || undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('POST /api/admin/contact-recovery error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Contact recovery failed' },
      { status: 500 },
    );
  }
}
