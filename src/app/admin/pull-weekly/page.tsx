'use client';

import { useState } from 'react';
import {
  Box, Button, Typography, Paper, Alert, CircularProgress,
  Stack, Divider, Chip, Table, TableHead, TableBody, TableRow, TableCell,
  TextField,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface WindowRow {
  label: string;
  kind: 'new_biz' | 'renewal';
  originationMin: string;
  originationMax: string;
  effectiveMin: string;
  effectiveMax: string;
  matched: number;
  alreadyHave: number;
  newPulled: number;
}
interface PullResult {
  dryRun: boolean;
  runDate: string;
  windows: WindowRow[];
  totals: { matched: number; alreadyHave: number; creditsSpent: number; dated: number };
}

export default function WeeklyPullPage() {
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<PullResult | null>(null);
  const [runResult, setRunResult] = useState<PullResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Renewal effective week to pull. Empty = today's auto-rolling window. The 60-day
  // lead offset is handled server-side (runDate = effDate − 60), so this is the
  // effective date the producer actually wants to work.
  const [effDate, setEffDate] = useState('');

  const pullQuery = effDate ? `?effDate=${effDate}` : '';

  // would-spend = brand-new candidates not already stored
  const wouldSpend = preview
    ? preview.windows.reduce((s, w) => s + Math.max(w.matched - w.alreadyHave, 0), 0)
    : 0;

  const runPreview = async () => {
    setPreviewing(true); setError(null); setRunResult(null); setPreview(null);
    try {
      const res = await fetch(`/api/admin/pull-weekly${pullQuery}`, { method: 'GET' });
      const json = await res.json();
      if (json.success) setPreview(json as PullResult);
      else setError(json.error || 'Preview failed');
    } catch { setError('Preview failed — try again'); }
    setPreviewing(false);
  };

  const runPull = async () => {
    if (!confirm(
      `This will spend ~${wouldSpend} credits — pulling full data for ${wouldSpend} brand-new ` +
      `properties (records already in the database are reused for free).\n\nProceed?`
    )) return;
    setRunning(true); setError(null);
    try {
      const res = await fetch(`/api/admin/pull-weekly${pullQuery}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) { setRunResult(json as PullResult); setPreview(null); }
      else setError(json.error || 'Pull failed');
    } catch { setError('Pull failed — try again'); }
    setRunning(false);
  };

  const renderWindows = (r: PullResult, mode: 'preview' | 'result') => (
    <Table size="small" sx={{ mt: 1 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 700 }}>Window</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Effective</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Origination</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Matched</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Have</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>{mode === 'preview' ? 'New (credits)' : 'Pulled'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {r.windows.map((w) => (
          <TableRow key={w.label}>
            <TableCell>
              <Chip label={w.label} size="small" color={w.kind === 'renewal' ? 'info' : 'success'} variant="outlined" />
            </TableCell>
            <TableCell>{w.effectiveMin} → {w.effectiveMax}</TableCell>
            <TableCell>{w.originationMin} → {w.originationMax}</TableCell>
            <TableCell align="right">{w.matched}</TableCell>
            <TableCell align="right">{w.alreadyHave}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>
              {mode === 'preview' ? Math.max(w.matched - w.alreadyHave, 0) : w.newPulled}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 820, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>Weekly Lead Pull</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pulls a 7-day slice — new business (90-day lead) + renewals (60-day lead,
        origination years 2022–2025). <strong>Preview is free</strong>; only brand-new properties
        cost credits when you run it.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <TextField
            label="Renewal effective week starting"
            type="date"
            size="small"
            value={effDate}
            onChange={(e) => { setEffDate(e.target.value); setPreview(null); setRunResult(null); }}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 240 }}
          />
          <Typography variant="caption" color="text.secondary">
            {effDate
              ? `Renewals effective the week of ${effDate}. Leave blank to pull today’s auto-rolling window.`
              : 'Leave blank to pull today’s auto-rolling window, or pick the renewal effective week you want to work.'}
          </Typography>
          {effDate && (
            <Button size="small" onClick={() => { setEffDate(''); setPreview(null); setRunResult(null); }}>
              Reset to today
            </Button>
          )}
        </Stack>
      </Paper>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Button
          variant="outlined" size="large"
          startIcon={previewing ? <CircularProgress size={18} color="inherit" /> : <VisibilityIcon />}
          onClick={runPreview} disabled={previewing || running}
        >
          {previewing ? 'Scanning…' : 'Preview (free)'}
        </Button>
        <Button
          variant="contained" size="large" color="primary"
          startIcon={running ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
          onClick={runPull} disabled={!preview || running || previewing}
        >
          {running ? 'Pulling…' : preview ? `Run Pull — ~${wouldSpend} credits` : 'Run Pull'}
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {preview && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Preview for run date {preview.runDate} — free scan, no credits used
          </Typography>
          {renderWindows(preview, 'preview')}
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip label={`Matched: ${preview.totals.matched}`} size="small" />
            <Chip label={`Already have: ${preview.totals.alreadyHave}`} size="small" />
            <Chip label={`Would spend: ${wouldSpend} credits`} size="small" color="primary" />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Click <strong>Run Pull</strong> to fetch full data for the {wouldSpend} new properties and enrich them.
          </Typography>
        </Paper>
      )}

      {runResult && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
          <Typography gutterBottom sx={{ fontWeight: 700 }}>
            Pull complete for {runResult.runDate}
          </Typography>
          {renderWindows(runResult, 'result')}
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Chip label={`Credits spent: ${runResult.totals.creditsSpent}`} size="small" color="primary" />
            <Chip label={`Reused free: ${runResult.totals.alreadyHave}`} size="small" color="success" variant="outlined" />
            <Chip label={`Dated: ${runResult.totals.dated}`} size="small" />
          </Stack>
        </Alert>
      )}

      <Divider sx={{ my: 3 }} />
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'info.50' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>How it stays cheap</Typography>
        <Typography variant="body2" color="text.secondary">
          Finding the leads (the <code>ids_only</code> scan) is always free. We only spend credits
          pulling full data for properties we don&apos;t already have — renewals pulled in a prior year
          are reused for $0. Run it once a week for contiguous coverage.
        </Typography>
      </Paper>
    </Box>
  );
}
