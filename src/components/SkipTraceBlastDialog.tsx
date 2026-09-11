'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box,
  LinearProgress, Alert, Chip, Stack, CircularProgress, Divider,
} from '@mui/material';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';

/**
 * Deep Skip Trace Blast (Frank Sep-2026) — traces every Grade A lead in the
 * selected effective-date range.
 *
 * Two things shape this dialog:
 *
 *  1. It always previews before it spends. The preview is a free API call, so
 *     there is no reason to make someone spend credits to find out how many
 *     credits they are about to spend.
 *  2. It drives the run in bounded chunks rather than one long request. The
 *     server commits each lead as it goes and a traced lead drops out of the
 *     eligible set, so closing this dialog mid-run loses nothing and re-opening
 *     it resumes — no lead is ever charged twice.
 */

export type BlastFilters = {
  grade?: string;
  status?: string;
  carrier?: string;
  propertyType?: string;
  county?: string;
  zip?: string;
  engine?: number;
  effectiveDate?: string;
  effectiveTo?: string;
};

type Preview = {
  matching: number;
  eligible: number;
  skipped: { alreadyTraced: number; missingName: number; wrongGrade: number };
  maxCredits: number;
  credits?: {
    known: boolean;
    low: boolean;
    remaining: number | null;
    matchesRemaining: number | null;
  };
};

type Tally = {
  processed: number; hit: number; miss: number; failed: number;
  creditsSpent: number; phone: number; email: number; coInsured: number;
};

const EMPTY: Tally = { processed: 0, hit: 0, miss: 0, failed: 0, creditsSpent: 0, phone: 0, email: 0, coInsured: 0 };

function queryFrom(f: BlastFilters): string {
  const q = new URLSearchParams();
  if (f.grade) q.set('grade', f.grade);
  if (f.status) q.set('status', f.status);
  if (f.carrier) q.set('carrier', f.carrier);
  if (f.propertyType) q.set('propertyType', f.propertyType);
  if (f.county) q.set('county', f.county);
  if (f.zip) q.set('zip', f.zip);
  if (f.engine) q.set('engine', String(f.engine));
  if (f.effectiveDate) q.set('effectiveDate', f.effectiveDate);
  if (f.effectiveTo) q.set('effectiveTo', f.effectiveTo);
  return q.toString();
}

const fmt = (n: number) => n.toLocaleString();

export default function SkipTraceBlastDialog({
  open, onClose, filters, onFinished,
}: {
  open: boolean;
  onClose: () => void;
  filters: BlastFilters;
  /** Fired once a run ends with at least one lead traced, so the page can refresh. */
  onFinished: (tally: Tally) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<Tally>(EMPTY);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  // Read inside the chunk loop so Stop takes effect on the next chunk boundary
  // rather than waiting for a state re-render.
  const stopRef = useRef(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/skiptrace-blast?${queryFrom(filters)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not preview the blast');
      setPreview(json);
      setRemaining(json.eligible);
    } catch (err: any) {
      setError(err?.message || 'Could not preview the blast');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // This component is mounted only while the blast is open (the Leads page renders
  // it conditionally), so every run starts from the initial state above and there is
  // nothing to reset here — just fetch the free preview.
  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const run = async () => {
    // One id for the whole run, so every chunk stamps the same blastRunId and the
    // QC report can show this run as a run rather than as N unrelated traces.
    const runId = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    stopRef.current = false;
    setRunning(true);
    setError(null);
    const running: Tally = { ...EMPTY };

    try {
      // Loop until the server says there is nothing left, or the user stops.
      // Each pass is a self-contained, already-committed unit of work.
      for (;;) {
        if (stopRef.current) break;
        const res = await fetch(`/api/admin/skiptrace-blast?${queryFrom(filters)}&chunk=25&runId=${runId}`, { method: 'POST' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Blast failed');

        running.processed += json.processed;
        running.hit += json.hit;
        running.miss += json.miss;
        running.failed += json.failed;
        running.creditsSpent += json.creditsSpent;
        running.phone += json.recovered?.phone ?? 0;
        running.email += json.recovered?.email ?? 0;
        running.coInsured += json.recovered?.coInsured ?? 0;
        setTally({ ...running });
        setRemaining(json.remaining);

        const last = json.results?.[json.results.length - 1];
        if (last) setCurrent(`${last.address}${last.owner ? ` — ${last.owner}` : ''}`);

        if (json.done) break;
      }
      setFinished(true);
      if (running.processed > 0) onFinished(running);
    } catch (err: any) {
      setError(err?.message || 'Blast failed');
      // Whatever completed before the failure is already saved — say so, and
      // let the page refresh so those leads show their new contacts.
      if (running.processed > 0) { setFinished(true); onFinished(running); }
    } finally {
      setRunning(false);
      setCurrent(null);
    }
  };

  const total = preview?.eligible ?? 0;
  const pct = total > 0 ? Math.min((tally.processed / total) * 100, 100) : 0;
  const canRun = !!preview && preview.eligible > 0 && !running && !finished;

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Deep Skip Trace Blast
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Grade A · effective {filters.effectiveDate} to {filters.effectiveTo}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Checking what this would trace…</Typography>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {preview && !running && !finished && (
          <>
            {preview.eligible === 0 ? (
              <Alert severity="info">
                Nothing to trace in this range — every matching Grade A lead has either been
                deep skip traced already or has no insured name on file.
              </Alert>
            ) : (
              <>
                <Typography variant="body1" sx={{ mb: 1.5 }}>
                  This will deep skip trace <strong>{fmt(preview.eligible)}</strong> Grade A
                  {' '}lead{preview.eligible === 1 ? '' : 's'}.
                </Typography>
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Up to <strong>{fmt(preview.maxCredits)} credits</strong> — 15 per lead that
                  Tracerfy matches. <strong>A miss costs nothing</strong>, so the real spend
                  lands below this.
                </Alert>
                {/* Said before the run, where it can still change the decision. */}
                {preview.credits?.known && preview.credits.low && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    <strong>Tracerfy credits are low.</strong>{' '}
                    {preview.credits.remaining != null
                      ? `About ${fmt(preview.credits.remaining)} left`
                      : 'Balance is below the warning level'}
                    {preview.credits.matchesRemaining != null
                      ? `, roughly ${fmt(preview.credits.matchesRemaining)} more matches.`
                      : '.'}
                    {' '}This run may stop partway — ask your manager to top up first.
                  </Alert>
                )}
              </>
            )}

            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {fmt(preview.matching)} lead{preview.matching === 1 ? '' : 's'} match the current filters
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" color="primary" variant="outlined" label={`${fmt(preview.eligible)} will be traced`} />
              {preview.skipped.alreadyTraced > 0 && (
                <Chip size="small" variant="outlined" label={`${fmt(preview.skipped.alreadyTraced)} already traced`} />
              )}
              {preview.skipped.missingName > 0 && (
                <Chip size="small" variant="outlined" label={`${fmt(preview.skipped.missingName)} no insured name`} />
              )}
              {preview.skipped.wrongGrade > 0 && (
                <Chip size="small" variant="outlined" label={`${fmt(preview.skipped.wrongGrade)} not Grade A`} />
              )}
            </Stack>
          </>
        )}

        {(running || finished) && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="body2">
                {running ? 'Tracing…' : 'Finished'} {fmt(tally.processed)} of {fmt(total)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {remaining != null ? `${fmt(remaining)} left` : ''}
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={pct} sx={{ height: 7, borderRadius: 1, mb: 2 }} />

            {running && current && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }} noWrap>
                {current}
              </Typography>
            )}

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              <Chip size="small" color="success" variant="outlined" label={`${fmt(tally.hit)} matched`} />
              <Chip size="small" variant="outlined" label={`${fmt(tally.miss)} no match`} />
              {tally.failed > 0 && <Chip size="small" color="error" variant="outlined" label={`${fmt(tally.failed)} failed`} />}
              <Chip size="small" color="warning" variant="outlined" label={`${fmt(tally.creditsSpent)} credits spent`} />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Recovered: <strong>{fmt(tally.phone)}</strong> phone
              {' · '}<strong>{fmt(tally.email)}</strong> email
              {' · '}<strong>{fmt(tally.coInsured)}</strong> co-insured
            </Typography>

            {finished && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {tally.processed === 0
                  ? 'Nothing was traced.'
                  : `Traced ${fmt(tally.processed)} lead${tally.processed === 1 ? '' : 's'} for ${fmt(tally.creditsSpent)} credits.`}
                {remaining ? ` ${fmt(remaining)} still untraced — run again to continue.` : ''}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {running ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
              Everything traced so far is already saved.
            </Typography>
            <Button onClick={() => { stopRef.current = true; }} color="inherit">Stop</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} color="inherit">{finished ? 'Close' : 'Cancel'}</Button>
            {canRun && (
              <Button
                variant="contained"
                color="warning"
                startIcon={<PersonSearchIcon />}
                onClick={run}
              >
                Trace {fmt(preview!.eligible)} lead{preview!.eligible === 1 ? '' : 's'}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
