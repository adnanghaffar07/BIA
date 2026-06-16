'use client';

import React from 'react';
import { AppBar, Toolbar, Typography, Box, IconButton } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useAuth } from '@/context/AuthContext';

export default function Navbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth();

  return (
    <AppBar position="sticky" elevation={0}>
      <Toolbar sx={{ minHeight: 52, px: { xs: 1.5, md: 3 } }}>
        {/* Hamburger — opens the sidebar drawer on small screens only */}
        {onMenuClick && (
          <IconButton
            onClick={onMenuClick}
            edge="start"
            aria-label="Open navigation menu"
            sx={{ display: { xs: 'inline-flex', md: 'none' }, color: 'inherit', mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        <Box sx={{ flex: 1 }} />
        {user?.email && (
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
            {user.email}
          </Typography>
        )}
      </Toolbar>
    </AppBar>
  );
}
