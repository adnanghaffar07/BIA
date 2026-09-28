'use client';

import React, { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar, { SIDEBAR_EXPANDED, SIDEBAR_COLLAPSED } from '@/components/Sidebar';
import CallReminderWatcher from '@/components/CallReminderWatcher';
import { useAuth } from '@/context/AuthContext';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  const [mounted,    setMounted]    = useState(false);
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Restore sidebar preference from localStorage
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved === 'true') setCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar-collapsed', String(!prev));
      return !prev;
    });
  };

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  /**
   * Routes that render without a session, and without the CRM shell.
   *
   * This list is SEPARATE from the middleware's PUBLIC_PATHS and has to agree with it.
   * When it did not, the CTA landing page passed the middleware, returned 200 to curl, and
   * was then bounced to /login by this effect the moment a real browser ran it — so every
   * homeowner clicking a button in our email would have been shown a staff login screen,
   * while every server-side check said the page was fine.
   *
   * '/c/' is the §05 CTA landing page: public by necessity, authenticated by the signed
   * token in the URL rather than by a session.
   */
  const PUBLIC_ROUTES = ['/login', '/c'];
  const isPublicRoute = PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + '/'),
  );

  useEffect(() => {
    if (!mounted || isLoading) return;
    if (!isPublicRoute && !isAuthenticated) router.push('/login');
    if (isAuthenticated && pathname === '/login') router.push('/');
  }, [mounted, isAuthenticated, isLoading, pathname, router, isPublicRoute]);

  if (!mounted || isLoading) {
    // Public routes (e.g. /login) render immediately — they have no shell.
    // Protected routes show a centered loader instead of flashing un-shelled
    // page content while auth + sidebar/navbar resolve.
    return (
      <Box
        sx={{
          minHeight: '100vh',
          backgroundColor: 'background.default',
          ...(isPublicRoute ? {} : { display: 'flex', alignItems: 'center', justifyContent: 'center' }),
        }}
      >
        {isPublicRoute ? children : <CircularProgress />}
      </Box>
    );
  }

  // Protected route but not authenticated — e.g. we just logged out or the session
  // expired. Do NOT render the page content (it would linger un-shelled until the
  // redirect completes). Show a loader while the effect above routes to /login.
  if (!isPublicRoute && !isAuthenticated) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  const shouldShowSidebar = !isPublicRoute && isAuthenticated;
  const sidebarW = shouldShowSidebar
    ? (collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED)
    : 0;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {shouldShowSidebar && (
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      )}
      {/*
        Beside the sidebar rather than inside a page, because a reminder set on one lead
        falls due while somebody is working the next one — a notice that only appears on the
        page that created it is a notice nobody sees.

        Gated on being signed in: it polls an endpoint that needs a session, and mounting it
        on the login screen would be a request a minute that can only ever 401.
      */}
      {shouldShowSidebar && <CallReminderWatcher />}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          backgroundColor: 'background.default',
          transition: 'margin-left 0.22s ease',
        }}
      >
        {shouldShowSidebar && <Navbar onMenuClick={() => setMobileOpen(true)} />}
        {/* Offset for the fixed (mobile) AppBar so content isn't hidden beneath it */}
        {shouldShowSidebar && <Box sx={{ display: { xs: 'block', md: 'none' }, height: 52, flexShrink: 0 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
