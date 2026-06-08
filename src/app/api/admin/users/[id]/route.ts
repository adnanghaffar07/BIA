import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, updateUserStatus, updateUserPassword } from '@/lib/auth';

async function requireSuperAdmin(request: NextRequest) {
  const token = request.cookies.get('bia_session')?.value;
  if (!token) return null;
  const user = await verifySessionToken(token);
  if (!user || user.role !== 'superadmin') return null;
  return user;
}

/** PATCH /api/admin/users/[id] — toggle active status or reset password */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  if (typeof body.isActive === 'boolean') {
    await updateUserStatus(id, body.isActive);
    return NextResponse.json({ success: true, message: `User ${body.isActive ? 'activated' : 'deactivated'}` });
  }

  if (body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    await updateUserPassword(id, body.password);
    return NextResponse.json({ success: true, message: 'Password updated' });
  }

  return NextResponse.json({ success: false, error: 'No valid update provided' }, { status: 400 });
}
