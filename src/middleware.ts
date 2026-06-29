import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'bia-crm-secret-change-in-production-2026'
);

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/enrich'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow internal Next.js assets
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('bia_session')?.value;

  if (!token) {
    // API routes return 401; page routes redirect to login
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // Guard /admin routes:
    //   • User management (/admin/users) → superadmin only (manages roles/admins).
    //   • Other admin pages (Weekly Pull, Seed) → superadmin + admin.
    //   • Regular users (BIA producers) → leads-only, no admin pages.
    const isUserMgmt = pathname.startsWith('/admin/users') || pathname.startsWith('/api/admin/users');
    const isAdminArea = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
    const allowed = isUserMgmt
      ? payload.role === 'superadmin'
      : isAdminArea
        ? (payload.role === 'superadmin' || payload.role === 'admin')
        : true;
    if (!allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Session expired' }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('bia_session');
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
