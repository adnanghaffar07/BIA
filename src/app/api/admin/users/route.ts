import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, getAllUsers, createUser } from '@/lib/auth';

async function requireSuperAdmin(request: NextRequest) {
  const token = request.cookies.get('bia_session')?.value;
  if (!token) return null;
  const user = await verifySessionToken(token);
  if (!user || user.role !== 'superadmin') return null;
  return user;
}

/** GET /api/admin/users — list all users (SuperAdmin only) */
export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
  }

  const users = await getAllUsers();
  return NextResponse.json({ success: true, data: users });
}

/** POST /api/admin/users — create a new user (SuperAdmin only) */
export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
  }

  const body = await request.json();
  const { email, password, name, role } = body;

  if (!email || !password || !name) {
    return NextResponse.json(
      { success: false, error: 'email, password, and name are required' },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { success: false, error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  const validRoles = ['admin', 'superadmin'];
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ success: false, error: 'Invalid role' }, { status: 400 });
  }

  try {
    const user = await createUser({
      email,
      password,
      name,
      role: role || 'admin',
      createdBy: admin.id,
    });
    return NextResponse.json({ success: true, data: user }, { status: 201 });
  } catch (err: any) {
    if (err?.message?.includes('unique') || err?.message?.includes('duplicate')) {
      return NextResponse.json({ success: false, error: 'Email already exists' }, { status: 409 });
    }
    throw err;
  }
}
