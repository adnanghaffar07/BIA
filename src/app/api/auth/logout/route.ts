import { NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const token = request.cookies.get('bia_session')?.value;

  if (token) {
    await revokeSession(token).catch(() => {}); // best-effort revocation
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete('bia_session');
  return response;
}
