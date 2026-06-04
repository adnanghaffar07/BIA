'use client';

import React, { useEffect } from 'react';
import { Box } from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/context/AuthContext';

const SIDEBAR_WIDTH = 260;

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  // Routes that don't require authentication
  const publicRoutes = ['/login'];
  
  // Routes that require authentication
  const protectedRoutes = ['/', '/dashboard', '/leads'];

  useEffect(() => {
    if (isLoading) return;

    // Check if current route is protected and user is not authenticated
    const isPublicRoute = publicRoutes.includes(pathname);
    const isProtectedRoute = protectedRoutes.includes(pathname);

    if (isProtectedRoute && !isAuthenticated && !isPublicRoute) {
      router.push('/login');
    }

    // If user is logged in and tries to access login page, redirect to dashboard
    if (isAuthenticated && pathname === '/login') {
      router.push('/');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        {/* Loading skeleton could go here */}
      </Box>
    );
  }

  // Show sidebar on protected routes (not login)
  const shouldShowSidebar = pathname !== '/login' && isAuthenticated;

  return (
    <>
      {shouldShowSidebar && <Navbar />}
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
        }}
      >
        {shouldShowSidebar && <Sidebar />}
        <Box
          sx={{
            flex: 1,
            backgroundColor: '#f5f5f5',
            overflowY: 'auto',
          }}
        >
          {children}
        </Box>
      </Box>
    </>
  );
}
