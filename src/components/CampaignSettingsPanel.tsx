'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, TextField, MenuItem, Stack, Alert, Typography, Box, Chip,
  CircularProgress, Divider, FormControlLabel, Switch, Paper,
} from '@mui/material';
import {
  CAMPAIGN_TIMEZONES, DEFAULT_CAMPAIGN_TIMEZONE, DAY_LABELS,
} from '@/lib/integrations/campaignTimezones';

/**
 * Campaign settings — name, sending window, daily limit and tracking.
 *
 * The schedule is sent whole rather than field by field: the platform replaces the
 * schedules array outright, so a partial patch would blank whatever it omitted.
 *
 * Rendered inline as a tab panel, so there is no Cancel button to fall back on —
 * unsaved edits are reported upward through onDirtyChange and the page guards the
 * tab switch rather than discarding them silently.
 */

export type CampaignSettings = {
  name: string;
  dailyLimit: number | null;
  unsubscribeHeader: boolean | null;
  openTracking: boolean | null;
  linkTracking: boolean | null;
  schedule: { from: string; to: string; days: Record<string, boolean>; timezone: string | null } | null;
};

const DEFAULT_DAYS: Record<string, boolean> =
  { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false };

export default function CampaignSettingsPanel({
  campaignId, current, onSaved, onDirtyChange,
}: {
  campaignId: string;
  current: CampaignSettings;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const startDays =
    current.schedule?.days && Object.keys(current.schedule.days).length
      ? current.schedule.days
      : DEFAULT_DAYS;

  const [name, setName] = useState(current.name);
  const [from, setFrom] = useState(current.schedule?.from ?? '09:00');
  const [to, setTo] = useState(current.schedule?.to ?? '17:00');
  const [days, setDays] = useState<Record<string, boolean>>(startDays);
  const [timezone, setTimezone] = useState(current.schedule?.timezone ?? DEFAULT_CAMPAIGN_TIMEZONE);
  const [dailyLimit, setDailyLimit] = useState(current.dailyLimit != null ? String(current.dailyLimit) : '');
  const [unsub, setUnsub] = useState(current.unsubscribeHeader !== false);
  const [openTracking, setOpenTracking] = useState(!!current.openTracking);
  const [linkTracking, setLinkTracking] = useState(!!current.linkTracking);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noDays = !Object.values(days).some(Boolean);

  const dirty =
    name !== current.name
    || from !== (current.schedule?.from ?? '09:00')
    || to !== (current.schedule?.to ?? '17:00')
    || timezone !== (current.schedule?.timezone ?? DEFAULT_CAMPAIGN_TIMEZONE)
    || dailyLimit !== (current.dailyLimit != null ? String(current.dailyLimit) : '')
    || unsub !== (current.unsubscribeHeader !== false)
    || openTracking !== !!current.openTracking
    || linkTracking !== !!current.linkTracking
    || JSON.stringify(days) !== JSON.stringify(startDays);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          dailyLimit: dailyLimit ? Number(dailyLimit) : undefined,
          unsubscribeHeader: unsub,
          openTracking,
          linkTracking,
          schedule: { from, to, days, timezone },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save the settings');
      onDirtyChange?.(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2.5} sx={{ maxWidth: 680 }}>
        {error && <Alert severity="error">{error}</Alert>}

        <TextField label="Campaign name" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Sending window
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
            <TextField label="From" type="time" size="small" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="To" type="time" size="small" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField select label="Timezone" size="small" value={timezone} onChange={(e) => setTimezone(e.target.value)} sx={{ minWidth: 210 }}>
              {CAMPAIGN_TIMEZONES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.75 }}>
            {DAY_LABELS.map((d) => (
              <Chip
                key={d.key} label={d.label} size="small" clickable
                onClick={() => setDays((prev) => ({ ...prev, [d.key]: !prev[d.key] }))}
                color={days[d.key] ? 'primary' : 'default'}
                variant={days[d.key] ? 'filled' : 'outlined'}
              />
            ))}
          </Stack>
          {noDays && <Alert severity="warning" sx={{ mt: 1.5 }}>No days selected — this campaign will never send.</Alert>}
        </Box>

        <TextField
          label="Daily send limit" type="number" size="small" value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
          helperText="Leave blank for the platform default."
          sx={{ maxWidth: 260 }}
        />

        <Divider />
        <Stack spacing={0.5}>
          <FormControlLabel
            control={<Switch size="small" checked={unsub} onChange={(e) => setUnsub(e.target.checked)} />}
            label={<Typography variant="body2">One-click unsubscribe header</Typography>}
          />
          {!unsub && (
            <Alert severity="warning">
              Sending without a one-click unsubscribe header is a compliance and
              deliverability risk. Leave this on unless you have a specific reason.
            </Alert>
          )}
          <FormControlLabel
            control={<Switch size="small" checked={openTracking} onChange={(e) => setOpenTracking(e.target.checked)} />}
            label={<Typography variant="body2">Open tracking</Typography>}
          />
          <FormControlLabel
            control={<Switch size="small" checked={linkTracking} onChange={(e) => setLinkTracking(e.target.checked)} />}
            label={<Typography variant="body2">Link tracking</Typography>}
          />
          </Stack>

        <Divider />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained" onClick={save} disabled={saving || !name.trim() || !dirty}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {dirty && !saving && (
            <Typography variant="caption" color="warning.main">Unsaved changes</Typography>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
