'use client';

import React, { useEffect, useState } from 'react';
import {
  Container, Box, Typography, Button, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Chip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, Alert, CircularProgress,
  Tooltip, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/PersonAdd';
import LockResetIcon from '@mui/icons-material/LockReset';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin';
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
}

export default function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset password dialog
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState('');
  const [resetUserName, setResetUserName] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (currentUser && currentUser.role !== 'superadmin') {
      router.push('/');
      return;
    }
    fetchUsers();
  }, [currentUser]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) setUsers(data.data);
      else setError(data.error);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    setFormError(null);
    if (!form.name || !form.email || !form.password) {
      setFormError('All fields are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setCreateOpen(false);
        setForm({ name: '', email: '', password: '', role: 'admin' });
        setSuccess('User created successfully');
        fetchUsers();
      } else {
        setFormError(data.error);
      }
    } catch {
      setFormError('Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      });
      setSuccess(`User ${currentStatus ? 'deactivated' : 'activated'}`);
      fetchUsers();
    } catch {
      setError('Failed to update user status');
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    try {
      await fetch(`/api/admin/users/${resetUserId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      setResetOpen(false);
      setNewPassword('');
      setSuccess('Password updated successfully');
    } catch {
      setError('Failed to reset password');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <AdminPanelSettingsIcon sx={{ color: '#1a237e' }} />
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>User Management</Typography>
          </Stack>
          <Typography variant="body2" color="textSecondary">
            SuperAdmin only — create and manage BIA CRM accounts
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ backgroundColor: '#1a237e' }}
        >
          Add User
        </Button>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Users Table */}
      <TableContainer component={Paper} sx={{ boxShadow: 2 }}>
        <Table>
          <TableHead sx={{ backgroundColor: '#f5f5f5' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Email</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Role</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : users.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Chip
                    label={u.role === 'superadmin' ? 'Super Admin' : 'Admin'}
                    size="small"
                    sx={{
                      backgroundColor: u.role === 'superadmin' ? '#1a237e' : '#e3f2fd',
                      color: u.role === 'superadmin' ? 'white' : '#1565c0',
                      fontWeight: 'bold',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={u.isActive ? 'Active' : 'Inactive'}
                    size="small"
                    sx={{
                      backgroundColor: u.isActive ? '#e8f5e9' : '#ffebee',
                      color: u.isActive ? '#2e7d32' : '#c62828',
                      fontWeight: 'bold',
                    }}
                  />
                </TableCell>
                <TableCell sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                  {new Date(u.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell align="center">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center' }}>
                    <Tooltip title="Reset Password">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setResetUserId(u.id);
                          setResetUserName(u.name);
                          setResetOpen(true);
                        }}
                      >
                        <LockResetIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {u.id !== currentUser?.id && (
                      <Tooltip title={u.isActive ? 'Deactivate' : 'Activate'}>
                        <IconButton
                          size="small"
                          color={u.isActive ? 'error' : 'success'}
                          onClick={() => handleToggleActive(u.id, u.isActive)}
                        >
                          {u.isActive
                            ? <BlockIcon fontSize="small" />
                            : <CheckCircleIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Add New User</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Full Name" fullWidth required
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="Email Address" type="email" fullWidth required
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <TextField
              label="Password" type="password" fullWidth required
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              helperText="Minimum 8 characters"
            />
            <FormControl fullWidth>
              <InputLabel>Role</InputLabel>
              <Select
                value={form.role}
                label="Role"
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <MenuItem value="admin">Admin (Producer / Staff)</MenuItem>
                <MenuItem value="superadmin">Super Admin</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateUser}
            disabled={submitting}
            sx={{ backgroundColor: '#1a237e' }}
          >
            {submitting ? 'Creating...' : 'Create User'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Reset Password</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Set a new password for <strong>{resetUserName}</strong>
          </Typography>
          <TextField
            label="New Password" type="password" fullWidth
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            helperText="Minimum 8 characters"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleResetPassword} sx={{ backgroundColor: '#1a237e' }}>
            Update Password
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
