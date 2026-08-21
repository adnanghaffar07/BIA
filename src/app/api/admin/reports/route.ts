import { NextRequest, NextResponse } from 'next/server';
import { getQcReport, QcReportType } from '@/services/reports.service';

const VALID: QcReportType[] = ['referral', 'grade_overrides', 'keyword', 'roof_b', 'type_mismatch', 'owner_verify', 'contact_coverage', 'skiptrace_mismatch'];

/**
 * GET /api/admin/reports?report=referral|grade_overrides|keyword|roof_b
 *   referral       → &carrier=travelers|plymouth|any &value=review|ineligible|eligible
 *   keyword        → &q=<term>
 *   all            → optional &effFrom=YYYY-MM-DD &effTo=YYYY-MM-DD
 * Admin/superadmin only (enforced by middleware on /api/admin).
 */
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams;
    const report = p.get('report') as QcReportType | null;
    if (!report || !VALID.includes(report)) {
      return NextResponse.json({ success: false, error: 'Invalid report type' }, { status: 400 });
    }
    const rows = await getQcReport(report, {
      carrier: (p.get('carrier') as any) || 'any',
      value: (p.get('value') as any) || 'review',
      setBy: (p.get('setBy') as any) || 'any',
      q: p.get('q') || '',
      effFrom: p.get('effFrom') || undefined,
      effTo: p.get('effTo') || undefined,
    });
    return NextResponse.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('GET /api/admin/reports error:', error);
    return NextResponse.json({ success: false, error: 'Failed to run report' }, { status: 500 });
  }
}
