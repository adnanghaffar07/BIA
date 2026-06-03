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
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  return (
    <AppBar position="sticky" sx={{ boxShadow: 2 }}>
      <Container maxWidth="lg">
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

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              component={Link}
              href="/"
              color="inherit"
              sx={{
                textTransform: 'none',
                fontSize: '1rem',
                borderBottom: isActive('/') ? '2px solid white' : 'none',
                paddingBottom: isActive('/') ? '8px' : '10px',
                transition: 'all 0.3s ease',
                '&:hover': {
                  borderBottom: '2px solid white',
                  paddingBottom: '8px',
                },
              }}
            >
              Home
            </Button>

            <Button
              component={Link}
              href="/leads"
              color="inherit"
              sx={{
                textTransform: 'none',
                fontSize: '1rem',
                borderBottom: isActive('/leads') ? '2px solid white' : 'none',
                paddingBottom: isActive('/leads') ? '8px' : '10px',
                transition: 'all 0.3s ease',
                '&:hover': {
                  borderBottom: '2px solid white',
                  paddingBottom: '8px',
                },
              }}
            >
              Leads
            </Button>
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
