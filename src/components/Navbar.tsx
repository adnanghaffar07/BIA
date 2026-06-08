'use client';

import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
  Container,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '@/context/AuthContext';

export default function Navbar() {
  const router = useRouter();
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <AppBar position="sticky" sx={{ boxShadow: 2 }}>
      <Container maxWidth="lg" sx={{ width: '100%' }}>
        <Toolbar disableGutters>
          <Typography
            variant="h6"
            sx={{
              flexGrow: 1,
              fontWeight: 'bold',
              fontSize: '1.3rem',
              background: 'linear-gradient(45deg, #fff 30%, #e0e0e0 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            🏢 BIA
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {user && (
              <Typography
                variant="body2"
                sx={{
                  color: 'white',
                  fontSize: '0.9rem',
                }}
              >
                {user.email}
              </Typography>
            )}

            {/* <Button
              onClick={handleLogout}
              color="inherit"
              startIcon={<LogoutIcon />}
              sx={{
                textTransform: 'none',
                fontSize: '1rem',
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                },
              }}
            >
              Logout
            </Button> */}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
