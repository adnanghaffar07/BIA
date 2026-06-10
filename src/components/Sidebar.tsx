'use client';

import React from 'react';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon,
  ListItemText, Divider, Typography, Tooltip, IconButton,
} from '@mui/material';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import QueueIcon from '@mui/icons-material/PlaylistAddCheck';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useAuth } from '@/context/AuthContext';

export const SIDEBAR_EXPANDED  = 240;
export const SIDEBAR_COLLAPSED = 64;

// ── Palette (matches theme sidebar bg) ────────────────────────────────────────
const BG        = '#0f172a';  // slate-900
const ACTIVE_BG = 'rgba(37, 99, 235, 0.18)';
const HOVER_BG  = 'rgba(255, 255, 255, 0.06)';
const ACTIVE_BORDER = '#2563eb';
const ICON_DEFAULT  = 'rgba(255,255,255,0.55)';
const ICON_ACTIVE   = '#60a5fa';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { logout, user } = useAuth();

  const isActive = (path: string) =>
    path === '/dashboard' ? pathname === '/dashboard' || pathname === '/'
    : pathname === path || pathname.startsWith(path + '/');

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const navItems = [
    { label: 'Dashboard',   icon: <DashboardIcon />,        path: '/dashboard' },
    { label: 'Leads',       icon: <PeopleIcon />,           path: '/leads' },
    { label: 'Lead Queues', icon: <QueueIcon />,            path: '/queue' },
    ...(user?.role === 'superadmin' ? [
      { label: 'Users',       icon: <ManageAccountsIcon />,  path: '/admin/users' },
      { label: 'Seed Control',icon: <CloudSyncIcon />,       path: '/admin/seed' },
    ] : []),
  ];

  const w = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const content = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: BG,
        color: 'white',
        overflowX: 'hidden',
        transition: 'width 0.22s ease',
        width: w,
      }}
    >
      {/* ── Logo / header ───────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 1.5,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          minHeight: 56,
          gap: 1,
        }}
      >
        {/* Logo mark — always visible */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            overflow: 'hidden',
            flex: collapsed ? 'none' : 1,
          }}
        >
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1,
              backgroundColor: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>
              BIA
            </Typography>
          </Box>
          {!collapsed && (
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: '1rem',
                letterSpacing: '0.03em',
                color: '#f8fafc',
                whiteSpace: 'nowrap',
              }}
            >
              CRM
            </Typography>
          )}
        </Box>

        {/* Collapse toggle — hidden when collapsed, shows on expand side */}
        {!collapsed && (
          <Tooltip title="Collapse sidebar" placement="right">
            <IconButton
              onClick={onToggle}
              size="small"
              sx={{
                color: 'rgba(255,255,255,0.4)',
                flexShrink: 0,
                '&:hover': { color: '#fff', backgroundColor: HOVER_BG },
              }}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Expand button pinned at top when collapsed */}
      {collapsed && (
        <Tooltip title="Expand sidebar" placement="right">
          <IconButton
            onClick={onToggle}
            size="small"
            sx={{
              mt: 0.5,
              mx: 'auto',
              display: 'flex',
              color: 'rgba(255,255,255,0.4)',
              '&:hover': { color: '#fff', backgroundColor: HOVER_BG },
            }}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      {/* ── Nav items ───────────────────────────────────────────────────── */}
      <List sx={{ flex: 1, pt: 1.5, px: collapsed ? 0.5 : 1 }}>
        {navItems.map((item) => {
          const active = isActive(item.path);
          const btn = (
            <ListItemButton
              component={Link}
              href={item.path}
              selected={active}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                px: collapsed ? 1.25 : 1.5,
                py: 1,
                justifyContent: collapsed ? 'center' : 'flex-start',
                backgroundColor: active ? ACTIVE_BG : 'transparent',
                borderLeft: active ? `3px solid ${ACTIVE_BORDER}` : '3px solid transparent',
                '&:hover': { backgroundColor: active ? ACTIVE_BG : HOVER_BG },
                transition: 'all 0.15s ease',
                minHeight: 44,
              }}
            >
              <ListItemIcon
                sx={{
                  color: active ? ICON_ACTIVE : ICON_DEFAULT,
                  minWidth: collapsed ? 0 : 36,
                  justifyContent: 'center',
                }}
              >
                {item.icon}
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary={item.label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: '0.875rem',
                        fontWeight: active ? 700 : 400,
                        color: active ? '#f8fafc' : 'rgba(255,255,255,0.75)',
                      },
                    },
                  }}
                />
              )}
            </ListItemButton>
          );

          return (
            <ListItem key={item.path} disablePadding>
              {collapsed
                ? <Tooltip title={item.label} placement="right">{btn}</Tooltip>
                : btn
              }
            </ListItem>
          );
        })}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: collapsed ? 0.5 : 1 }} />

      {/* ── User + logout ────────────────────────────────────────────────── */}
      <Box sx={{ px: collapsed ? 0.5 : 1, py: 1.5 }}>
        {!collapsed && user?.email && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              px: 1.5,
              pb: 1,
              color: 'rgba(255,255,255,0.35)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.email}
          </Typography>
        )}
        {(() => {
          const logoutBtn = (
            <ListItemButton
              onClick={handleLogout}
              sx={{
                borderRadius: 1.5,
                px: collapsed ? 1.25 : 1.5,
                py: 1,
                justifyContent: collapsed ? 'center' : 'flex-start',
                backgroundColor: 'rgba(220,38,38,0.08)',
                '&:hover': { backgroundColor: 'rgba(220,38,38,0.18)' },
                minHeight: 44,
              }}
            >
              <ListItemIcon sx={{ color: '#f87171', minWidth: collapsed ? 0 : 36, justifyContent: 'center' }}>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary="Logout"
                  slotProps={{ primary: { sx: { fontSize: '0.875rem', fontWeight: 600, color: '#f87171' } } }}
                />
              )}
            </ListItemButton>
          );
          return collapsed
            ? <Tooltip title="Logout" placement="right">{logoutBtn}</Tooltip>
            : logoutBtn;
        })()}
      </Box>
    </Box>
  );

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: w,
        flexShrink: 0,
        transition: 'width 0.22s ease',
        '& .MuiDrawer-paper': {
          width: w,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          border: 'none',
          transition: 'width 0.22s ease',
          boxShadow: '2px 0 8px rgba(0,0,0,0.25)',
        },
      }}
    >
      {content}
    </Drawer>
  );
}
