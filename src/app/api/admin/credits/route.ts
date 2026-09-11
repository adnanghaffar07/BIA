import { NextRequest, NextResponse } from 'next/server';
import { getCreditStatus, setCreditCheckpoint, setLowThreshold } from '@/services/credits.service';

/**
 * Tracerfy credit status (Frank Sep-2026).
 *
 *   GET  /api/admin/credits              → { known, remaining, low, threshold, … }
 *   POST /api/admin/credits              → record a new balance checkpoint
 *        body: { balance: number, threshold?: number }
 *
 * Tracerfy exposes no balance endpoint, so `balance` is the figure from their
 * dashboard. Everything spent since is derived from the traces themselves — see
 * credits.service.ts — so the checkpoint only needs re-entering after a top-up,
 * not after every run.
 *
 * Admin + superadmin only (middleware on /api/admin).
 */
export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await getCreditStatus()) });
  } catch (err: any) {
    console.error('GET /api/admin/credits error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not read credit status' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const balance = Number(body?.balance);
    if (!Number.isFinite(balance) || balance < 0) {
      return NextResponse.json(
        { success: false, error: 'Enter the credit balance shown in the Tracerfy dashboard.' },
        { status: 400 },
      );
    }
    await setCreditCheckpoint(balance);
    if (Number.isFinite(Number(body?.threshold)) && Number(body.threshold) >= 0) {
      await setLowThreshold(Number(body.threshold));
    }
    return NextResponse.json({ success: true, ...(await getCreditStatus()) });
  } catch (err: any) {
    console.error('POST /api/admin/credits error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not save the balance' },
      { status: 500 },
    );
  }
}
