'use client';

import React, { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar, { SIDEBAR_EXPANDED, SIDEBAR_COLLAPSED } from '@/components/Sidebar';
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

  const PUBLIC_ROUTES = ['/login'];
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

  const shouldShowSidebar = !isPublicRoute && isAuthenticated;
  const sidebarW = shouldShowSidebar
    ? (collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED)
    : 0;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {shouldShowSidebar && (
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      )}
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
