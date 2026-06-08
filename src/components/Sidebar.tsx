'use client';

import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
  IconButton,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import QueueIcon from '@mui/icons-material/PlaylistAddCheck';
import LogoutIcon from '@mui/icons-material/Logout';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { useAuth } from '@/context/AuthContext';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

const DRAWER_WIDTH = 260;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const isActive = (path: string) => pathname === path;

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const baseItems = [
    { label: 'Dashboard',   icon: <DashboardIcon />, path: '/' },
    { label: 'Leads',       icon: <PeopleIcon />,    path: '/leads' },
    { label: 'Lead Queues', icon: <QueueIcon />,     path: '/queue' },
  ];

  const adminItems = user?.role === 'superadmin'
    ? [{ label: 'User Management', icon: <ManageAccountsIcon />, path: '/admin/users' }]
    : [];

  const menuItems = [...baseItems, ...adminItems];

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#1a237e',
        color: 'white',
      }}
    >
      {/* Logo Section */}
      <Box sx={{ p: 2, textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography
          variant="h6"
          sx={{
            fontWeight: 'bold',
            fontSize: '1.3rem',
            background: 'linear-gradient(45deg, #fff 30%, #e0e0e0 90%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          🏢 BIA
        </Typography>
      </Box>

      {/* Navigation Menu */}
      <List sx={{ flex: 1, pt: 2 }}>
        {menuItems.map((item, index) => (
          <ListItem key={index} disablePadding sx={{ mb: 1, mx: 1 }}>
            <ListItemButton
              component={Link}
              href={item.path}
              selected={isActive(item.path)}
              onClick={() => isMobile && setMobileOpen(false)}
              sx={{
                color: 'white',
                borderLeft: isActive(item.path) ? '4px solid #64b5f6' : '4px solid transparent',
                backgroundColor: isActive(item.path) ? 'rgba(100, 181, 246, 0.1)' : 'transparent',
                borderRadius: '8px',
                transition: 'all 0.3s ease',
                '&:hover': {
                  backgroundColor: 'rgba(100, 181, 246, 0.15)',
                  borderLeft: '4px solid #64b5f6',
                },
              }}
            >
              <ListItemIcon sx={{ color: isActive(item.path) ? '#64b5f6' : 'white', minWidth: 40 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{ primary: { fontWeight: isActive(item.path) ? 'bold' : 'normal' } }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Divider */}
      <Divider sx={{ backgroundColor: 'rgba(255,255,255,0.1)' }} />

      {/* Logout Section */}
      <Box sx={{ p: 2 }}>
        <ListItemButton
          onClick={handleLogout}
          sx={{
            color: 'white',
            justifyContent: 'center',
            backgroundColor: 'rgba(244, 67, 54, 0.1)',
            borderRadius: '8px',
            transition: 'all 0.3s ease',
            '&:hover': {
              backgroundColor: 'rgba(244, 67, 54, 0.2)',
            },
          }}
        >
          <ListItemIcon sx={{ color: '#ef5350', minWidth: 40 }}>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText
            primary="Logout"
            slotProps={{ primary: { fontWeight: 'bold' } }}
          />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <>
      {/* Desktop Drawer */}
      {!isMobile && (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              boxShadow: 2,
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <>
          <Box
            sx={{
              position: 'fixed',
              top: 16,
              left: 16,
              zIndex: 1200,
            }}
          >
            <IconButton
              onClick={() => setMobileOpen(!mobileOpen)}
              sx={{
                backgroundColor: '#1a237e',
                color: 'white',
                '&:hover': {
                  backgroundColor: '#0d47a1',
                },
              }}
            >
              {mobileOpen ? <CloseIcon /> : <MenuIcon />}
            </IconButton>
          </Box>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            sx={{
              '& .MuiDrawer-paper': {
                width: DRAWER_WIDTH,
                boxSizing: 'border-box',
              },
            }}
          >
            {drawerContent}
          </Drawer>
        </>
      )}
    </>
  );
}
