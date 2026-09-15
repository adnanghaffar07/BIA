'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack,
  TextField, MenuItem, Chip, CircularProgress, Alert, LinearProgress, Divider,
  } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { COUNTY_FILTER_OPTIONS } from '@/lib/constants';

/**
 * Push CRM leads into a campaign.
 *
 * Previews for free before anything is sent, then runs in bounded chunks — each one
 * committed before the next starts, so stopping halfway leaves a clean, resumable
 * state rather than an unknown one.
 */

type Preview = {
  matching: number;
  eligible: number;
  skipped: { noEmail: number; suppressed: number; holdout: number; alreadyInCampaign: number; duplicateAddress: number };
  overCap: boolean;
  maxPerPush: number;
  sample: Array<{ email: string; role: string; address: string }>;
};

type Tally = { pushed: number; failed: number; skippedOnPlatform: number };

const GRADES = ['A', 'B', 'C'];
const PROPERTY_TYPES = [
  { value: '', label: 'Any type' },
  { value: 'SFR', label: 'Single family' },
  { value: 'CONDO', label: 'Condo' },
];

export default function CampaignPushDialog({
  open, onClose, campaignId, campaignName, onFinished,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  onFinished: (t: Tally) => void;
}) {
  const [grade, setGrade] = useState('A');
  const [county, setCounty] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Tally>({ pushed: 0, failed: 0, skippedOnPlatform: 0 });
  const [remaining, setRemaining] = useState<number | null>(null);
  const [problems, setProblems] = useState<Array<{ email: string; reason?: string }>>([]);
  const stopRef = useRef(false);

  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (grade) q.set('grade', grade);
    if (county) q.set('county', county);
    if (propertyType) q.set('propertyType', propertyType);
    if (effectiveDate) q.set('effectiveDate', effectiveDate);
    if (effectiveTo) q.set('effectiveTo', effectiveTo);
    return q.toString();
  }, [grade, county, propertyType, effectiveDate, effectiveTo]);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}/push?${query()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not preview the push');
      setPreview(json);
      setRemaining(json.eligible);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview the push');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId, query]);

  useEffect(() => { if (!running && !finished) loadPreview(); }, [loadPreview, running, finished]);

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    setError(null);
    const t: Tally = { pushed: 0, failed: 0, skippedOnPlatform: 0 };
    const issues: Array<{ email: string; reason?: string }> = [];
    try {
      for (;;) {
        if (stopRef.current) break;
        const res = await fetch(`/api/lead-campaigns/${campaignId}/push?${query()}&chunk=3`, { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Push failed');
        t.pushed += json.pushed;
        t.failed += json.failed;
        t.skippedOnPlatform += json.skippedOnPlatform;
        setTally({ ...t });
        setRemaining(json.remaining);
        for (const r of json.results ?? []) if (!r.ok) issues.push({ email: r.email, reason: r.reason });
        setProblems([...issues].slice(0, 20));
        if (json.done) break;
      }
      setFinished(true);
      if (t.pushed > 0 || t.failed > 0) onFinished(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
      if (t.pushed > 0) { setFinished(true); onFinished(t); }
    } finally {
      setRunning(false);
    }
  };

  const total = preview?.eligible ?? 0;
  const done = tally.pushed + tally.failed + tally.skippedOnPlatform;
  const pctDone = total > 0 ? Math.min((done / total) * 100, 100) : 0;
  const canRun = !!preview && preview.eligible > 0 && !preview.overCap && !running && !finished;

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Add leads from the CRM
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          into {campaignName}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {!running && !finished && (
          <>
            <Stack spacing={2} sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1.5}>
                <TextField select size="small" label="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} sx={{ minWidth: 110 }}>
                  {GRADES.map((g) => <MenuItem key={g} value={g}>Grade {g}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="County" value={county} onChange={(e) => setCounty(e.target.value)} sx={{ minWidth: 150 }}>
                  <MenuItem value="">All counties</MenuItem>
                  {COUNTY_FILTER_OPTIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Type" value={propertyType} onChange={(e) => setPropertyType(e.target.value)} sx={{ minWidth: 140 }}>
                  {PROPERTY_TYPES.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small" type="date" label="Effective from" value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth
                />
                <TextField
                  size="small" type="date" label="Effective to" value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} fullWidth
                />
              </Stack>
            </Stack>

            <Divider sx={{ mb: 2 }} />

            {loading ? (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">Working out who matches…</Typography>
              </Stack>
            ) : error ? (
              <Alert severity="error">{error}</Alert>
            ) : preview ? (
              <>
                <Typography variant="body1" sx={{ mb: 1.5 }}>
                  <strong>{preview.eligible.toLocaleString()}</strong> of {preview.matching.toLocaleString()} matching
                  {' '}lead{preview.matching === 1 ? '' : 's'} would be added.
                </Typography>

                {preview.overCap && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    That is more than {preview.maxPerPush} at a time. Narrow the filter — a push
                    that quietly truncates is worse than one that refuses.
                  </Alert>
                )}
                {preview.eligible === 0 && !preview.overCap && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Nothing to add with these filters.
                  </Alert>
                )}

                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
                  <Chip size="small" color="primary" variant="outlined" label={`${preview.eligible} to add`} />
                  {preview.skipped.noEmail > 0 && <Chip size="small" variant="outlined" label={`${preview.skipped.noEmail} no email`} />}
                  {preview.skipped.alreadyInCampaign > 0 && <Chip size="small" variant="outlined" label={`${preview.skipped.alreadyInCampaign} already in this campaign`} />}
                  {preview.skipped.suppressed > 0 && <Chip size="small" sx={{ bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 }} label={`${preview.skipped.suppressed} suppressed`} />}
                  {preview.skipped.holdout > 0 && <Chip size="small" variant="outlined" label={`${preview.skipped.holdout} holdout`} />}
                  {preview.skipped.duplicateAddress > 0 && <Chip size="small" variant="outlined" label={`${preview.skipped.duplicateAddress} duplicate address`} />}
                </Stack>

                {preview.sample.length > 0 && (
                  <Box sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">First few:</Typography>
                    {preview.sample.map((s) => (
                      <Typography key={s.email} variant="caption" sx={{ display: 'block', color: '#5c6b78' }}>
                        {s.email} — {s.address}
                      </Typography>
                    ))}
                  </Box>
                )}
              </>
            ) : null}
          </>
        )}

        {(running || finished) && (
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="body2">
                {running ? 'Adding…' : 'Finished'} {done.toLocaleString()} of {total.toLocaleString()}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {remaining != null ? `${remaining.toLocaleString()} left` : ''}
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pctDone} sx={{ height: 7, borderRadius: 1, mb: 2 }} />

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              <Chip size="small" sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} label={`${tally.pushed} added`} />
              {tally.skippedOnPlatform > 0 && <Chip size="small" variant="outlined" label={`${tally.skippedOnPlatform} already on the platform`} />}
              {tally.failed > 0 && <Chip size="small" sx={{ bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 }} label={`${tally.failed} failed`} />}
            </Stack>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {problems.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">Not added:</Typography>
                {problems.map((p, i) => (
                  <Typography key={`${p.email}-${i}`} variant="caption" sx={{ display: 'block', color: '#8a5a00' }}>
                    {p.email} — {p.reason}
                  </Typography>
                ))}
              </Box>
            )}

            {finished && (
              <Alert severity="success">
                {tally.pushed > 0
                  ? `${tally.pushed} lead${tally.pushed === 1 ? '' : 's'} added. Replies and bounces will now come back onto the CRM record.`
                  : 'Nothing was added.'}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {running ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
              Everything added so far is already saved.
            </Typography>
            <Button onClick={() => { stopRef.current = true; }} color="inherit">Stop</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} color="inherit">{finished ? 'Close' : 'Cancel'}</Button>
            {canRun && (
              <Button variant="contained" startIcon={<SendIcon />} onClick={run}>
                Add {preview!.eligible.toLocaleString()} lead{preview!.eligible === 1 ? '' : 's'}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
