import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, verifyPassword, createSessionToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const user = await getUserByEmail(email);

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const authUser = { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive };
    const token = await createSessionToken(authUser);

    const response = NextResponse.json({ success: true, user: authUser });

    // Store JWT in httpOnly cookie — cannot be read by JavaScript
    response.cookies.set('bia_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[auth/login]', error);
    return NextResponse.json({ success: false, error: 'Login failed' }, { status: 500 });
  }
}
