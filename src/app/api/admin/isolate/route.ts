import { NextRequest, NextResponse } from 'next/server';
import { isolateUnreachable } from '@/services/isolate.service';

/**
 * POST /api/admin/isolate
 *   body: { effFrom?, effTo?, dryRun? }
 *
 * Parks Grade A leads with no insured email as 'isolated', keeping the status they held
 * so it can be restored, and puts back any isolated lead that has since become reachable.
 * Admin/superadmin only (enforced by middleware on /api/admin).
 *
 * dryRun defaults TRUE — this changes producer-visible status on leads that are mostly
 * already rated, and that is not something to do merely because a request arrived.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any));
    const result = await isolateUnreachable({
      effFrom: body?.effFrom || undefined,
      effTo: body?.effTo || undefined,
      dryRun: body?.dryRun !== false,
      createdBy: body?._createdBy ?? null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('POST /api/admin/isolate error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Isolate failed' },
      { status: 500 },
    );
  }
}
