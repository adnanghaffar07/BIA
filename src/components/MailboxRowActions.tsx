'use client';

import React, { useState } from 'react';
import {
  IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Typography, TextField,
  Alert, CircularProgress,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * Per-mailbox actions: a warmup toggle on the row, plus Reconnect and Delete in the
 * menu — the same two the sending platform itself offers.
 *
 * ── Reconnect leaves the CRM, and has to ─────────────────────────────────────
 * The platform exposes no reconnect endpoint — /accounts/{email}/reconnect,
 * /accounts/reconnect, /connect and /reauth all answer "Route not found". That is not
 * an oversight: these are Google OAuth mailboxes, and re-consent is a browser flow
 * against Google that no API key can perform on the user's behalf. Offering a button
 * that claimed to reconnect would be a lie that fails silently at the worst moment.
 *
 * So "Reconnect" opens the platform's accounts page in a new tab, where the sign-in
 * can actually be completed. Pause, resume and mark-fixed remain on the API route but
 * are not surfaced here — the menu mirrors the platform's own two items.
 */

export type MailboxRow = {
  email: string;
  warmingUp: boolean;
  warmupScore: number | null;
  status: number | null;
  setupPending: boolean;
  statusLabel: string;
};

const ACCOUNTS_URL = 'https://app.instantly.ai/app/accounts';

export default function MailboxRowActions({
  mailbox, onChanged,
}: {
  mailbox: MailboxRow;
  /** Refresh the list; failures are reported in place, so nothing is passed up. */
  onChanged: () => void;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => setAnchor(null);

  const call = async (payload: Record<string, unknown>) => {
    setBusy(String(payload.action));
    setError(null);
    try {
      const res = await fetch('/api/lead-campaigns/accounts/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, emails: [mailbox.email] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'That did not work');
      onChanged();
      close();
      setConfirmDelete(false);
      setTyped('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* Warmup reads at a glance from the row, the way the platform shows it. */}
      <Tooltip title={mailbox.warmingUp ? `Warmup on — score ${mailbox.warmupScore ?? '—'}` : 'Warmup off'}>
        <span>
          <IconButton
            size="small"
            disabled={busy === 'warmup'}
            onClick={() => call({ action: 'warmup', on: !mailbox.warmingUp })}
          >
            {busy === 'warmup'
              ? <CircularProgress size={16} />
              : <LocalFireDepartmentIcon fontSize="small" sx={{ color: mailbox.warmingUp ? '#1a73e8' : '#c2c8d0' }} />}
          </IconButton>
        </span>
      </Tooltip>

      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreHorizIcon fontSize="small" />
      </IconButton>

      {/* Two items, matching the platform's own menu. Warmup lives on the row icon and
          pause/resume stay available on the API without cluttering this. */}
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <MenuItem component="a" href={ACCOUNTS_URL} target="_blank" rel="noopener noreferrer" onClick={close}>
          <ListItemIcon><RefreshIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Reconnect" />
        </MenuItem>

        <MenuItem onClick={() => { setConfirmDelete(true); close(); }} sx={{ color: '#b3261e' }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" sx={{ color: '#b3261e' }} /></ListItemIcon>
          <ListItemText primary="Delete" />
        </MenuItem>
      </Menu>

      {error && !confirmDelete && (
        <Alert severity="error" sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: 1400 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Dialog open={confirmDelete} onClose={busy ? undefined : () => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this mailbox?</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Alert severity="error" sx={{ mb: 2 }}>
            This removes the sending account from the platform entirely — not just from a
            campaign. Its warmup history and sending reputation go with it, and rebuilding
            those takes weeks. It cannot be undone.
          </Alert>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Type <strong>{mailbox.email}</strong> to confirm.
          </Typography>
          <TextField size="small" fullWidth value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} color="inherit" disabled={!!busy}>Cancel</Button>
          <Button
            variant="contained" color="error"
            disabled={!!busy || typed.trim().toLowerCase() !== mailbox.email.toLowerCase()}
            onClick={() => call({ action: 'delete', confirm: typed.trim() })}
            startIcon={busy === 'delete' ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete mailbox'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

