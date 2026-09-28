import { NextRequest, NextResponse } from 'next/server';
import { getPhoneDashboard, type PhoneFilters } from '@/services/phoneDashboard.service';
import type { CallStatus } from '@/lib/callOutcomes';

/**
 * GET /api/admin/phone-dashboard?cohortFrom&cohortTo&reach&status
 *
 * Admin/superadmin only (enforced by middleware on /api/admin).
 */
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REACH = new Set(['all', 'verified', 'unverified']);

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const filters: PhoneFilters = {};

    const from = q.get('cohortFrom');
    const to = q.get('cohortTo');
    if (from && DAY.test(from)) filters.cohortFrom = from;
    if (to && DAY.test(to)) filters.cohortTo = to;

    const reach = q.get('reach');
    if (reach && REACH.has(reach)) filters.reach = reach as PhoneFilters['reach'];

    const status = q.get('status');
    if (status) filters.status = status as CallStatus | 'all';

    return NextResponse.json({ success: true, ...await getPhoneDashboard(filters) });
  } catch (error) {
    console.error('GET /api/admin/phone-dashboard error:', error);
    return NextResponse.json({ success: false, error: 'Failed to read the phone dashboard' }, { status: 500 });
  }
}
