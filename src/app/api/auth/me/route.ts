import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('bia_session')?.value;

  if (!token) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const user = await verifySessionToken(token);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Session expired' }, { status: 401 });
  }

  return NextResponse.json({ success: true, user });
}
