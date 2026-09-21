import { NextRequest, NextResponse } from 'next/server';
import { bandAccuracy, lossAnalysis } from '@/services/quoteOutcomes.service';

/**
 * GET /api/admin/band-accuracy?by=carrier|propertyType|municipality|cohort
 *
 * Sec. 10.9 reported "monthly and by carrier, property type, municipality and cohort",
 * alongside Sec. 10.6's loss analysis — they answer one question together: is the band
 * right, and when it is wrong, who takes the business.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('by');
    const by = (['carrier', 'propertyType', 'municipality', 'cohort'] as const)
      .find((x) => x === raw) ?? 'carrier';
    const [accuracy, losses] = await Promise.all([bandAccuracy(by), lossAnalysis()]);
    return NextResponse.json({ success: true, by, accuracy, losses });
  } catch (error: unknown) {
    console.error('GET /api/admin/band-accuracy error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not build the report' },
      { status: 500 },
    );
  }
}
