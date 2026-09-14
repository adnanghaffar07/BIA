'use client';

import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Alert, Typography, CircularProgress,
} from '@mui/material';
import { DEFAULT_CAMPAIGN_TIMEZONE } from '@/lib/integrations/campaignTimezones';

/**
 * Create a campaign — name only.
 *
 * Everything else (schedule, sending mailboxes, email copy, limits) is set on the
 * campaign's own page after it exists. That is deliberate: a create form asking for
 * a sequence before the campaign exists forces every decision up front, and none of
 * those decisions are final — they are all editable afterwards anyway. Naming it and
 * landing in the campaign matches how the sending platform itself works.
 *
 * The campaign is created paused with a default weekday 9–5 Eastern schedule, so it
 * is valid immediately and can be adjusted in place.
 */
export default function CampaignCreateDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (campaign: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/lead-campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A valid default schedule so the campaign exists in a usable state; the
        // campaign page is where it gets adjusted.
        body: JSON.stringify({ name: name.trim(), timezone: DEFAULT_CAMPAIGN_TIMEZONE }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create the campaign');
      onCreated(json.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New campaign</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Campaign name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !saving) submit(); }}
            size="small" fullWidth autoFocus
            placeholder="e.g. Monmouth renewals — Oct week 1"
          />
          <Typography variant="body2" color="text.secondary">
            You&apos;ll set the schedule, sending mailboxes and email copy on the next screen.
            Nothing sends until you activate it.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>Cancel</Button>
        <Button
          variant="contained" onClick={submit} disabled={saving || !name.trim()}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? 'Creating…' : 'Create campaign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
