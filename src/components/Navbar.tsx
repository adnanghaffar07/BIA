'use client';

import React from 'react';
import { AppBar, Toolbar, Typography, Box } from '@mui/material';
import { useAuth } from '@/context/AuthContext';

export default function Navbar() {
  const { user } = useAuth();

  return (
    <AppBar position="sticky" elevation={0}>
      <Toolbar sx={{ minHeight: 52, px: 3 }}>
        <Box sx={{ flex: 1 }} />
        {user?.email && (
          <Typography
            variant="body2"
            sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}
          >
            {user.email}
          </Typography>
        )}
      </Toolbar>
    </AppBar>
  );
}
