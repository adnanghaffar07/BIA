'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack, Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * Can each campaign send, and what is stopping it.
 *
 * ── Why one screen ──────────────────────────────────────────────────────────
 * Nothing has reached a homeowner yet, and the reason was never one thing: no sending
 * mailbox, no signature, variables that arrive blank, contacts holding yesterday's values.
 * Each fact lived somewhere different, so "why hasn't this gone out" could only be answered
 * by somebody who knew all five places to look — and answered differently depending on which
 * they checked first.
 *
 * ── Stops and warnings are not the same colour ──────────────────────────────
 * A campaign with no mailbox physically cannot send. Copy with a blank variable sends
 * perfectly and arrives wrong. Both matter; only one is a hard stop. Flattening them into
 * one number would make a campaign that is one click from going out look the same as one
 * that is one afternoon away.
 */

type Gate = {
  key: string; label: string; ok: boolean;
  severity: 'blocker' | 'warning'; detail: string; fixAt: string;
};

type Campaign = {
  id: string; name: string; status: string; contacts: number;
  gates: Gate[]; blockers: number; warnings: number; ready: boolean;
};

export default function SendCheckPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/campaign-readiness')).json();
      if (!j.success) throw new Error(j.error || 'Could not check');
      setRows(j.campaigns as Campaign[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ready = rows.filter((r) => r.ready).length;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Can we send?</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Everything that has to be true before a campaign reaches a homeowner, checked live.
        Nothing here can be ticked off by hand — a line turns green when the thing it describes
        is actually true.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress />
          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: '#5a6675' }}>
            Reading every campaign, its contacts and each sending mailbox&apos;s signature — this
            takes a few seconds.
          </Typography>
        </Box>
      )}

      {!loading && !!rows.length && (
        <Alert severity={ready === rows.length ? 'success' : 'info'} sx={{ mb: 3 }}>
          <strong>{ready} of {rows.length} campaigns are ready to send.</strong>{' '}
          {ready === rows.length
            ? 'Every check passes.'
            : 'A red line means it cannot send at all. An amber one means it would send, and '
              + 'what arrives would be wrong.'}
        </Alert>
      )}


      <Stack spacing={2}>
        {rows.map((c) => (
          <Paper
            key={c.id}
            variant="outlined"
            sx={{
              p: 2,
              borderColor: c.ready ? '#b7dfc4' : c.blockers ? '#e6b3ad' : '#e8d3a0',
              bgcolor: c.ready ? '#fbfefc' : undefined,
            }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              {c.ready
                ? <CheckCircleIcon fontSize="small" sx={{ color: '#1b6b2f' }} />
                : c.blockers
                  ? <ErrorOutlineIcon fontSize="small" sx={{ color: '#b3261e' }} />
                  : <WarningAmberIcon fontSize="small" sx={{ color: '#8a5a00' }} />}
              <Box
                component="a" href={`/lead-campaigns/${c.id}`} target="_blank" rel="noopener"
                sx={{ fontWeight: 700 }}
              >
                {c.name}
              </Box>
              <Chip size="small" label={c.status} sx={{ height: 20, fontSize: 11 }} />
              <Chip size="small" variant="outlined" label={`${c.contacts} contacts`} sx={{ height: 20, fontSize: 11 }} />
            </Stack>

            <Divider sx={{ mb: 1 }} />

            <Stack spacing={0.75}>
              {c.gates.map((g) => (
                <Box key={g.key} sx={{ display: 'flex', gap: 1.25, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Chip
                    size="small"
                    label={g.ok ? 'ok' : g.severity === 'blocker' ? 'stops the send' : 'sends it wrong'}
                    sx={{
                      height: 20, fontSize: 11, fontWeight: 700, minWidth: 112,
                      bgcolor: g.ok ? '#e7f5ec' : g.severity === 'blocker' ? '#fdecea' : '#fff4e0',
                      color: g.ok ? '#166534' : g.severity === 'blocker' ? '#b3261e' : '#8a5a00',
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: g.ok ? 400 : 700, minWidth: 210 }}>
                    {g.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#5a6675', flex: 1, minWidth: 260 }}>
                    {g.detail}
                    {/*
                      Where to go, on the failing lines only. On a passing line it would be
                      noise, and a screen where every row carries an instruction is one where
                      none of them are read.
                    */}
                    {!g.ok && (
                      <Box component="span" sx={{ display: 'block', color: '#8a8f98', fontSize: 12 }}>
                        Fix at: {g.fixAt}
                      </Box>
                    )}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Container>
  );
}
