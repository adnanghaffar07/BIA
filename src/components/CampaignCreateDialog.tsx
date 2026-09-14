'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Stack, Alert, Typography, Box, Chip, CircularProgress, Divider,
} from '@mui/material';
import {
  CAMPAIGN_TIMEZONES, DEFAULT_CAMPAIGN_TIMEZONE, WEEKDAYS_ONLY, DAY_LABELS,
} from '@/lib/integrations/campaignTimezones';

/**
 * Create a campaign without leaving the CRM.
 *
 * The timezone list is imported from a constants file with no other imports — pulling
 * it from the API client would drag the server-only key-reading code into this
 * client bundle.
 */

type MailboxDomain = { domain: string; mailboxes: number; dailyCapacity: number; trackingDomain: string | null };

export default function CampaignCreateDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (campaign: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_CAMPAIGN_TIMEZONE);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('17:00');
  const [days, setDays] = useState<Record<string, boolean>>({ ...WEEKDAYS_ONLY });
  const [dailyLimit, setDailyLimit] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyCopy, setBodyCopy] = useState('');
  const [domains, setDomains] = useState<MailboxDomain[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lead-campaigns/accounts')
      .then((r) => r.json())
      .then((j) => { if (j.success) setDomains(j.data ?? []); })
      .catch(() => { /* the picker is informational; failure should not block creating */ });
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/lead-campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          timezone, from, to, days,
          dailyLimit: dailyLimit ? Number(dailyLimit) : undefined,
          subject: subject.trim() || undefined,
          body: bodyCopy.trim() || undefined,
        }),
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

  const toggleDay = (key: string) => setDays((d) => ({ ...d, [key]: !d[key] }));
  const capacity = domains.reduce((s, d) => s + d.dailyCapacity, 0);

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New campaign</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Campaign name" value={name} onChange={(e) => setName(e.target.value)}
            size="small" fullWidth autoFocus
            placeholder="e.g. Monmouth renewals — Oct week 1"
          />

          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Sending window
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <TextField label="From" type="time" size="small" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="To" type="time" size="small" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField
                select label="Timezone" size="small" value={timezone}
                onChange={(e) => setTimezone(e.target.value)} sx={{ minWidth: 210 }}
              >
                {CAMPAIGN_TIMEZONES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </TextField>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
              {DAY_LABELS.map((d) => (
                <Chip
                  key={d.key} label={d.label} size="small" clickable
                  onClick={() => toggleDay(d.key)}
                  color={days[d.key] ? 'primary' : 'default'}
                  variant={days[d.key] ? 'filled' : 'outlined'}
                />
              ))}
            </Stack>
          </Box>

          <TextField
            label="Daily send limit" type="number" size="small" value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            helperText={
              capacity > 0
                ? `Your mailboxes can send about ${capacity.toLocaleString()}/day in total. Leave blank for the platform default.`
                : 'Leave blank for the platform default.'
            }
          />

          <Divider />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              First email (optional — a campaign with no step cannot send)
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="Subject" size="small" fullWidth value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Your home insurance renews soon"
              />
              <TextField
                label="Body" size="small" fullWidth multiline minRows={4} value={bodyCopy}
                onChange={(e) => setBodyCopy(e.target.value)}
                placeholder={'Hi {{firstName}},\n\n…'}
                helperText="Merge fields like {{firstName}} are filled per lead."
              />
            </Stack>
          </Box>

          <Alert severity="info">
            Created paused, with one-click unsubscribe on and stop-on-reply set. Nothing
            sends until you activate it.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>Cancel</Button>
        <Button
          variant="contained" onClick={submit}
          disabled={saving || !name.trim()}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? 'Creating…' : 'Create campaign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
