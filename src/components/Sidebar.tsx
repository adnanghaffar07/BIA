'use client';

import React from 'react';
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon,
  ListItemText, Divider, Typography, Tooltip, IconButton,
} from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import QueueIcon from '@mui/icons-material/PlaylistAddCheck';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import AssessmentIcon from '@mui/icons-material/Assessment';
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
  /** Mobile (<md) temporary-drawer state. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  const isActive = (path: string) =>
    path === '/dashboard' ? pathname === '/dashboard' || pathname === '/'
    : pathname === path || pathname.startsWith(path + '/');

  const handleLogout = async () => {
    onMobileClose?.();
    // logout() clears client state and hard-redirects to /login itself.
    await logout();
  };

  const navItems = [
    { label: 'Dashboard',   icon: <DashboardIcon />,        path: '/dashboard' },
    { label: 'Leads',       icon: <PeopleIcon />,           path: '/leads' },
    { label: 'Lead Queues', icon: <QueueIcon />,            path: '/queue' },
    // Super-admin only: user / role management
    ...(user?.role === 'superadmin' ? [
      { label: 'Users',       icon: <ManageAccountsIcon />,  path: '/admin/users' },
    ] : []),
    // Admin + super-admin: data operations
    ...(user?.role === 'superadmin' || user?.role === 'admin' ? [
      { label: 'QC Reports',  icon: <AssessmentIcon />,      path: '/admin/qc' },
      { label: 'Weekly Pull', icon: <EventRepeatIcon />,     path: '/admin/pull-weekly' },
    ] : []),
  ];

  // Shared sidebar body. On mobile we always render the full (expanded) layout
  // and swap the collapse toggle for a close button; tapping a nav item closes it.
  const renderContent = (isCollapsed: boolean, mobile: boolean) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: BG,
        color: 'white',
        overflowX: 'hidden',
        transition: 'width 0.22s ease',
        width: isCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      }}
    >
      {/* ── Logo / header ───────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 1.5,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          minHeight: 56,
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden', flex: isCollapsed ? 'none' : 1 }}>
          <Box
            sx={{
              width: 30, height: 30, borderRadius: 1, backgroundColor: '#2563eb',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>BIA</Typography>
          </Box>
          {!isCollapsed && (
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '0.03em', color: '#f8fafc', whiteSpace: 'nowrap' }}>
              CRM
            </Typography>
          )}
        </Box>

        {mobile ? (
          <IconButton onClick={onMobileClose} size="small" aria-label="Close menu"
            sx={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0, '&:hover': { color: '#fff', backgroundColor: HOVER_BG } }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        ) : !isCollapsed && (
          <Tooltip title="Collapse sidebar" placement="right">
            <IconButton onClick={onToggle} size="small"
              sx={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0, '&:hover': { color: '#fff', backgroundColor: HOVER_BG } }}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Expand button pinned at top when collapsed (desktop only) */}
      {!mobile && isCollapsed && (
        <Tooltip title="Expand sidebar" placement="right">
          <IconButton onClick={onToggle} size="small"
            sx={{ mt: 0.5, mx: 'auto', display: 'flex', color: 'rgba(255,255,255,0.4)', '&:hover': { color: '#fff', backgroundColor: HOVER_BG } }}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}

      {/* ── Nav items ───────────────────────────────────────────────────── */}
      <List sx={{ flex: 1, pt: 1.5, px: isCollapsed ? 0.5 : 1 }}>
        {navItems.map((item) => {
          const active = isActive(item.path);
          const btn = (
            <ListItemButton
              component={Link}
              href={item.path}
              selected={active}
              onClick={mobile ? onMobileClose : undefined}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                px: isCollapsed ? 1.25 : 1.5,
                py: 1,
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                backgroundColor: active ? ACTIVE_BG : 'transparent',
                borderLeft: active ? `3px solid ${ACTIVE_BORDER}` : '3px solid transparent',
                '&:hover': { backgroundColor: active ? ACTIVE_BG : HOVER_BG },
                transition: 'all 0.15s ease',
                minHeight: 44,
              }}
            >
              <ListItemIcon sx={{ color: active ? ICON_ACTIVE : ICON_DEFAULT, minWidth: isCollapsed ? 0 : 36, justifyContent: 'center' }}>
                {item.icon}
              </ListItemIcon>
              {!isCollapsed && (
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
              {isCollapsed
                ? <Tooltip title={item.label} placement="right">{btn}</Tooltip>
                : btn}
            </ListItem>
          );
        })}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.07)', mx: isCollapsed ? 0.5 : 1 }} />

      {/* ── User + logout ────────────────────────────────────────────────── */}
      <Box sx={{ px: isCollapsed ? 0.5 : 1, py: 1.5 }}>
        {!isCollapsed && user?.email && (
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 1.5, pb: 1, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
                px: isCollapsed ? 1.25 : 1.5,
                py: 1,
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                backgroundColor: 'rgba(220,38,38,0.08)',
                '&:hover': { backgroundColor: 'rgba(220,38,38,0.18)' },
                minHeight: 44,
              }}
            >
              <ListItemIcon sx={{ color: '#f87171', minWidth: isCollapsed ? 0 : 36, justifyContent: 'center' }}>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              {!isCollapsed && (
                <ListItemText primary="Logout" slotProps={{ primary: { sx: { fontSize: '0.875rem', fontWeight: 600, color: '#f87171' } } }} />
              )}
            </ListItemButton>
          );
          return isCollapsed
            ? <Tooltip title="Logout" placement="right">{logoutBtn}</Tooltip>
            : logoutBtn;
        })()}
      </Box>
    </Box>
  );

  const w = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  return (
    <>
      {/* Desktop (md+): permanent rail in the layout flow */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
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
        {renderContent(collapsed, false)}
      </Drawer>

      {/* Mobile (<md): temporary overlay drawer, opened from the top bar */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: SIDEBAR_EXPANDED,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            border: 'none',
          },
        }}
      >
        {renderContent(false, true)}
      </Drawer>
    </>
  );
}
