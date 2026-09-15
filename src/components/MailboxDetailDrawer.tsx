'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Drawer, Box, Stack, Typography, Tabs, Tab, IconButton, Button, TextField, Switch,
  FormControlLabel, Slider, Divider, Chip, Alert, CircularProgress, Table, TableHead,
  TableRow, TableCell, TableBody, Tooltip, Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

/**
 * Account Details — warmup, settings and campaigns for one sending mailbox.
 *
 * Mirrors the sending platform's own drawer, and every control is bound to a field
 * that was verified against the live API rather than assumed. That verification
 * mattered: PATCH /accounts/{email} ignores unknown keys and still returns 200, so a
 * control wired to a guessed field name would appear to save and silently do nothing.
 *
 * Three controls in the platform's drawer are absent because its API does not expose
 * them at all: Signature, Tags, and the Warmup Filter Tag. PATCH accepts and discards
 * those keys without error, so there is no way to offer them honestly — they stay the
 * platform's own. Recorded here rather than on screen: the gap is a fact about the
 * vendor that a future reader needs, not a message the operator needs every visit.
 */

type Detail = {
  email: string;
  firstName: string; lastName: string;
  status: number | null; statusLabel: string;
  warmupOn: boolean; warmupScore: number | null; warmupStartedAt: string | null;
  dailyLimit: number | null; sendingGap: number | null; slowRamp: boolean;
  inboxPlacementTestLimit: number | null; replyTo: string;
  trackingDomain: string; trackingDomainStatus: string | null; trackingDomainActive: boolean;
  warmup: {
    increment: string | number; limit: number | null; replyRate: number | null;
    warmCtd: boolean; openRate: number; spamSaveRate: number; importantRate: number;
    weekdayOnly: boolean; readEmulation: boolean;
  };
};

type Payload = {
  account: Detail;
  warmupSummary: { received: number; sent: number; landedInbox: number; savedFromSpam: number; healthScore: number | null };
  warmupDaily: Array<{ date: string; sent: number; received: number; landedInbox: number; savedFromSpam: number }>;
  campaigns: Array<{ id: string; name: string; status: number; statusLabel: string }>;
};

const daysAgo = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
};

/** Warmup sends per day, drawn as SVG — one small chart does not justify a dependency. */
function WarmupChart({ data }: { data: Payload['warmupDaily'] }) {
  const W = 620, H = 180, PAD = { t: 10, r: 10, b: 26, l: 30 };
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const max = Math.max(1, ...data.map((d) => d.sent));
  const slot = pw / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(26, slot - 10));

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 420, display: 'block' }} role="img" aria-label="Warmup emails sent per day">
        {[0, 0.5, 1].map((f) => {
          const v = Math.round(max * f);
          const y = PAD.t + ph - f * ph;
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke="#eceff3" strokeDasharray="3 3" />
              <text x={PAD.l - 6} y={y + 3.5} textAnchor="end" fontSize={9} fill="#8a94a3">{v}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = PAD.l + i * slot + (slot - bw) / 2;
          const hSent = (d.sent / max) * ph;
          const hSpam = (d.savedFromSpam / max) * ph;
          return (
            <g key={d.date}>
              <title>{`${d.date} — ${d.sent} sent, ${d.received} received, ${d.savedFromSpam} saved from spam`}</title>
              <rect x={x} y={PAD.t + ph - hSent} width={bw} height={hSent} fill="#2f7ae5" rx={2} />
              {hSpam > 0 && <rect x={x} y={PAD.t + ph - hSpam} width={bw} height={hSpam} fill="#d93025" rx={2} />}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#8a94a3">{d.date.slice(5)}</text>
            </g>
          );
        })}
      </svg>
      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#2f7ae5' }} />
          <Typography variant="caption" color="text.secondary">Warmup emails sent</Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#d93025' }} />
          <Typography variant="caption" color="text.secondary">Landed in spam</Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <Box sx={{ flex: '1 1 130px' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

export default function MailboxDetailDrawer({
  email, open, onClose, onChanged,
}: {
  email: string | null;
  open: boolean;
  onClose: () => void;
  /** Refresh the list; failures are reported in place, so nothing is passed up. */
  onChanged: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/accounts/${encodeURIComponent(email)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load that mailbox');
      setData(json);
      setForm(json.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that mailbox');
    } finally {
      setLoading(false);
    }
  }, [email]);

  // The initial fetch settles state in its callbacks rather than synchronously in the
  // effect body. The parent keys this component by address, so it remounts per mailbox
  // and the tab starts on Warmup without needing a reset here.
  useEffect(() => {
    if (!open || !email) return;
    let cancelled = false;
    fetch(`/api/lead-campaigns/accounts/${encodeURIComponent(email)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not load that mailbox');
        return json as Payload;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setForm(json.account);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load that mailbox');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, email]);

  const set = <K extends keyof Detail>(k: K, v: Detail[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const setW = <K extends keyof Detail['warmup']>(k: K, v: Detail['warmup'][K]) =>
    setForm((f) => (f ? { ...f, warmup: { ...f.warmup, [k]: v } } : f));

  const action = async (payload: Record<string, unknown>) => {
    if (!email) return;
    setBusy(String(payload.action));
    setError(null);
    try {
      const res = await fetch('/api/lead-campaigns/accounts/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, emails: [email] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'That did not work');
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!email || !form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/accounts/${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName,
          dailyLimit: form.dailyLimit, sendingGap: form.sendingGap,
          slowRamp: form.slowRamp, inboxPlacementTestLimit: form.inboxPlacementTestLimit,
          replyTo: form.replyTo,
          warmup: form.warmup,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save');
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const a = data?.account;
  const paused = a?.status === 2;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 620 } } } }}>
      <Box sx={{ p: 3, pb: 1 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Account Details</Typography>
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{email}</Typography>

        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 2, gap: 1 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 40 }}>
            <Tab label="Warmup" sx={{ minHeight: 40 }} />
            <Tab label="Settings" sx={{ minHeight: 40 }} />
            <Tab label={`Campaigns${data?.campaigns.length ? ` (${data.campaigns.length})` : ''}`} sx={{ minHeight: 40 }} />
          </Tabs>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              size="small" variant="outlined" disabled={!!busy || loading}
              startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
              onClick={() => action({ action: paused ? 'resume' : 'pause' })}
            >
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Tooltip title={a?.warmupOn ? 'Warmup on' : 'Warmup off'}>
              <span>
                <IconButton
                  size="small" disabled={!!busy || loading}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                  onClick={() => action({ action: 'warmup', on: !a?.warmupOn })}
                >
                  <LocalFireDepartmentIcon fontSize="small" sx={{ color: a?.warmupOn ? '#1a73e8' : '#c2c8d0' }} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      <Divider />

      <Box sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && !data && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading…</Typography>
          </Stack>
        )}

        {/* ── Warmup ── */}
        {data && form && tab === 0 && (
          <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <LocalFireDepartmentIcon sx={{ color: a?.warmupOn ? '#1a73e8' : '#c2c8d0' }} />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Warmup</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {a?.warmupStartedAt
                        ? `Started ${new Date(a.warmupStartedAt).toLocaleDateString()} · ${daysAgo(a.warmupStartedAt)}`
                        : 'Not started'}
                    </Typography>
                  </Box>
                </Stack>
                <Switch
                  checked={!!a?.warmupOn} disabled={!!busy}
                  onChange={() => action({ action: 'warmup', on: !a?.warmupOn })}
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Summary for past week</Typography>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                <Metric value={data.warmupSummary.received.toLocaleString()} label="Warmup emails received" />
                <Metric value={data.warmupSummary.sent.toLocaleString()} label="Warmup emails sent" />
                <Metric value={data.warmupSummary.savedFromSpam.toLocaleString()} label="Saved from spam" />
                {data.warmupSummary.healthScore != null && (
                  <Metric value={`${data.warmupSummary.healthScore}%`} label="Health score" />
                )}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Warmup emails sent</Typography>
              {data.warmupDaily.length
                ? <WarmupChart data={data.warmupDaily} />
                : <Typography variant="body2" color="text.secondary">No warmup activity yet.</Typography>}
            </Paper>
          </Stack>
        )}

        {/* ── Settings ── */}
        {data && form && tab === 1 && (
          <Stack spacing={2.5}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Sender name</Typography>
              <Stack direction="row" spacing={1.5}>
                <TextField label="First name" size="small" fullWidth value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
                <TextField label="Last name" size="small" fullWidth value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Campaign settings</Typography>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                  <TextField
                    label="Daily campaign limit" type="number" size="small" sx={{ flex: '1 1 180px' }}
                    value={form.dailyLimit ?? ''} onChange={(e) => set('dailyLimit', Number(e.target.value) || 0)}
                    helperText="Maximum campaign emails per day"
                  />
                  <TextField
                    label="Minimum wait time" type="number" size="small" sx={{ flex: '1 1 180px' }}
                    value={form.sendingGap ?? ''} onChange={(e) => set('sendingGap', Number(e.target.value) || 0)}
                    helperText="Minutes, when used with multiple campaigns"
                  />
                </Stack>
                <TextField
                  label="Reply-to address" size="small" fullWidth placeholder="reply@example.com"
                  value={form.replyTo} onChange={(e) => set('replyTo', e.target.value)}
                  helperText="Optional. Leaving this blank keeps whatever is already set — the platform rejects an empty value."
                />
                <TextField
                  label="Daily inbox placement test limit" type="number" size="small" sx={{ maxWidth: 280 }}
                  value={form.inboxPlacementTestLimit ?? ''}
                  onChange={(e) => set('inboxPlacementTestLimit', Number(e.target.value) || 0)}
                />
                <FormControlLabel
                  control={<Switch size="small" checked={form.slowRamp} onChange={(e) => set('slowRamp', e.target.checked)} />}
                  label={<Typography variant="body2">Campaign slow ramp — gradually increase emails sent per day</Typography>}
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Custom tracking domain</Typography>
                {a?.trackingDomainActive && (
                  <Chip size="small" icon={<CheckCircleIcon />} label="Verified" sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                )}
              </Stack>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {a?.trackingDomain || <em style={{ color: '#b3261e' }}>none — uses the shared domain</em>}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Status: {a?.trackingDomainStatus ?? 'not set'}. Changing this is done on the platform.
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Warmup settings</Typography>
              <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
                <TextField
                  label="Increase per day" type="number" size="small" sx={{ flex: '1 1 140px' }}
                  value={form.warmup.increment} onChange={(e) => setW('increment', e.target.value)}
                  helperText="Suggested 1, max 4"
                />
                <TextField
                  label="Daily warmup limit" type="number" size="small" sx={{ flex: '1 1 140px' }}
                  value={form.warmup.limit ?? ''} onChange={(e) => setW('limit', Number(e.target.value) || 0)}
                  helperText="Suggested 10, max 200"
                />
                <TextField
                  label="Reply rate %" type="number" size="small" sx={{ flex: '1 1 140px' }}
                  value={form.warmup.replyRate ?? ''} onChange={(e) => setW('replyRate', Number(e.target.value) || 0)}
                  helperText="Suggested 30"
                />
              </Stack>

              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Advanced</Typography>

              <FormControlLabel
                control={<Switch size="small" checked={form.warmup.weekdayOnly} onChange={(e) => setW('weekdayOnly', e.target.checked)} />}
                label={<Typography variant="body2">Weekdays only</Typography>}
              />
              <FormControlLabel
                control={<Switch size="small" checked={form.warmup.readEmulation} onChange={(e) => setW('readEmulation', e.target.checked)} />}
                label={<Typography variant="body2">Read emulation</Typography>}
              />
              <FormControlLabel
                control={<Switch size="small" checked={form.warmup.warmCtd} onChange={(e) => setW('warmCtd', e.target.checked)} />}
                label={<Typography variant="body2">Warm custom tracking domain</Typography>}
              />

              {([
                ['openRate', 'Open rate', 'How many of your warmup emails to open'],
                ['spamSaveRate', 'Spam protection', 'How many to save from the spam folder'],
                ['importantRate', 'Mark important', 'How many to mark as important'],
              ] as const).map(([key, label, hint]) => (
                <Box key={key} sx={{ mt: 2 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2">{label}</Typography>
                    <Chip size="small" label={form.warmup[key]} sx={{ height: 20, fontWeight: 700 }} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{hint}</Typography>
                  <Slider
                    size="small" min={0} max={100} value={Number(form.warmup[key])}
                    onChange={(_, v) => setW(key, v as number)}
                  />
                </Box>
              ))}
            </Paper>

          </Stack>
        )}

        {/* ── Campaigns ── */}
        {data && tab === 2 && (
          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.campaigns.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>
                      <Chip
                        size="small" label={c.statusLabel}
                        sx={{
                          height: 20, fontSize: 11, fontWeight: 600,
                          ...(c.status === 1 ? { bgcolor: '#dcfce7', color: '#166534' } : { bgcolor: '#e8eaed', color: '#5c6b78' }),
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {!data.campaigns.length && (
                  <TableRow>
                    <TableCell colSpan={2} sx={{ textAlign: 'center', py: 4, color: '#888' }}>
                      Not used by any campaign.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Box>

      {tab === 1 && data && (
        <>
          <Divider />
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained" onClick={save} disabled={saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </>
      )}
    </Drawer>
  );
}
