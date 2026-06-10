import { NextResponse } from 'next/server';
import { getPipelineSummary } from '@/services/storage.service';

/**
 * GET /api/dashboard
 * Returns live pipeline funnel counts for the dashboard.
 */
export async function GET() {
  try {
    const summary = await getPipelineSummary();
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error('[dashboard] Failed to get pipeline summary:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load dashboard data' },
      { status: 500 },
    );
  }
}
