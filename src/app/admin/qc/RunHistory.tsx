'use client';

import React from 'react';
import { Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';

/**
 * The run history (Frank, 24 Sep 2026 · fix 20).
 *
 * "Skip-trace runs and grading changes logged in real time, with cohort, account count and
 *  process."
 *
 * ── Why it sits under the pipeline counts ───────────────────────────────────
 * It answers the question the counts provoke. A stage reading "45 waiting" means one thing
 * if nothing has ever been run against that week and something else entirely if three runs
 * have already been over it and found nothing. The counts cannot tell those apart, and for
 * weeks that difference was the whole argument — 11/09 sat with 47 leads waiting and read
 * as though it had none.
 *
 * ── The three counts are shown separately on purpose ────────────────────────
 * Considered, reached and recovered are not interchangeable. Three recoveries out of a pool
 * of three is a finished week; three out of forty-seven is a week barely started. Collapsing
 * them into one number is how a bad run reads as a good one.
 */

export type RunRow = {
  id: string;
  process: string;
  processLabel: string;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: 'running' | 'ok' | 'failed' | 'aborted';
  cohortFrom: string | null;
  cohortTo: string | null;
  considered: number | null;
  touched: number | null;
  changed: number | null;
  byCohort: Record<string, number> | null;
  runBy: string | null;
  dryRun: boolean;
  detail: Record<string, unknown> | null;
  error: string | null;
};

const OUTCOME: Record<RunRow['outcome'], { label: string; bg: string; fg: string; help: string }> = {
  running: {
    label: 'Running', bg: '#e8eefc', fg: '#1a3d7c',
    help: 'Still going. A run that has said this for more than an hour did not finish — the process died, and nothing closed the row.',
  },
  ok: {
    label: 'Finished', bg: '#e7f5ec', fg: '#166534',
    help: 'Ran to the end of its batch.',
  },
  aborted: {
    label: 'Stopped early', bg: '#fff3d6', fg: '#8a5a00',
    help: 'The run ended itself — out of vendor credits, a rejected key, or three failed calls in a row. The accounts it never reached are still waiting.',
  },
  failed: {
    label: 'Failed', bg: '#fdecea', fg: '#b3261e',
    help: 'The run threw and stopped.',
  },
};

const when = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** Minutes, because a blast is measured in minutes and "0.03 hours" tells nobody anything. */
const took = (a: string | null, b: string | null) => {
  if (!a || !b) return '—';
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return '<1s';
  return ms < 90_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
};

const HEAD: Array<{ label: string; help: string; numeric?: boolean }> = [
  { label: 'Started', help: 'When the run began. The row is written at the START, so a run that is still going — or one that died half way — appears here too.' },
  { label: 'Process', help: 'Which process ran. A dry run is shown as one: it is a real run, and leaving it out would make this log disagree with the vendor bill.' },
  { label: 'Weeks', help: 'The renewal weeks the run was pointed at. Blank means it was pointed at the whole book.' },
  { label: 'Considered', help: 'Everything that qualified for this run. NOT the same as reached — a per-run limit, a trust-owned owner or an already-traced lead cuts the pool down.', numeric: true },
  { label: 'Reached', help: 'How many accounts the run actually called a vendor about. The gap between this and Considered is what says whether a week is finished or merely started.', numeric: true },
  { label: 'Came back', help: 'How many of those returned an insured email — the only thing that ends isolation. Phones found are counted separately and shown on hover.', numeric: true },
  { label: 'Took', help: 'How long it ran.' },
  { label: 'Ran by', help: 'Who pressed the button. Blank for a scheduled run.' },
  { label: 'Result', help: 'Whether it finished, stopped itself, or is still going.' },
];

export default function RunHistory({ runs, stalled }: { runs: RunRow[]; stalled?: RunRow[] }) {
  if (!runs.length) {
    return (
      <Typography variant="caption" sx={{ color: '#5a6675' }}>
        No runs recorded yet. Every blast from here on writes a row — including one that finds nothing,
        which is the case that previously left no trace at all.
      </Typography>
    );
  }

  const stalledIds = new Set((stalled ?? []).map((r) => r.id));

  return (
    <Box>
      {stalledIds.size > 0 && (
        <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: '#fff8e8', borderColor: '#e0c07a' }}>
          <Typography variant="caption" sx={{ color: '#8a5a00', fontWeight: 600 }}>
            {stalledIds.size} run{stalledIds.size === 1 ? '' : 's'} still showing as running after an hour.
            {' '}That means the process stopped without closing its row — the accounts it was working are
            free to be run again.
          </Typography>
        </Paper>
      )}
      <Table size="small">
        <TableHead>
          <TableRow>
            {HEAD.map((h) => (
              <TableCell key={h.label} align={h.numeric ? 'right' : 'left'}
                sx={{ fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11.5, py: 0.5 }}>
                <Tooltip title={h.help} arrow placement="top">
                  <span style={{ cursor: 'help', borderBottom: '1px dotted #b9c0cc' }}>{h.label}</span>
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((r) => {
            const o = OUTCOME[r.outcome] ?? OUTCOME.ok;
            const weeks = r.cohortFrom || r.cohortTo
              ? `${r.cohortFrom ?? 'start'} → ${r.cohortTo ?? 'today'}`
              : 'whole book';
            const perWeek = r.byCohort && Object.keys(r.byCohort).length
              ? Object.entries(r.byCohort).map(([c, n]) => `${c}: ${n}`).join('\n')
              : 'No per-week split recorded for this run.';
            const phones = Number((r.detail as any)?.phoneOnly ?? 0);
            return (
              <TableRow key={r.id} hover sx={stalledIds.has(r.id) ? { bgcolor: '#fffdf5' } : undefined}>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{when(r.startedAt)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {r.processLabel}
                  {r.dryRun && (
                    <Chip size="small" label="dry run"
                      sx={{ ml: 0.5, height: 17, fontSize: 10, bgcolor: '#eef1f5', color: '#5a6675' }} />
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{perWeek}</Box>} arrow>
                    <span style={{ cursor: 'help' }}>{weeks}</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={{ fontSize: 12 }}>{r.considered ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontSize: 12 }}>{r.touched ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700 }}>
                  <Tooltip
                    title={phones
                      ? `${phones} more gained a phone but no insured email, so they stay in the pipeline — the phone is kept and Ruben can call it.`
                      : 'Accounts that gained an insured email, which is the only thing that ends isolation.'}
                    arrow
                  >
                    <span style={{ cursor: 'help' }}>{r.changed ?? '—'}</span>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{took(r.startedAt, r.finishedAt)}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.runBy ?? '—'}</TableCell>
                <TableCell>
                  <Tooltip title={r.error ? `${o.help}\n\n${r.error}` : o.help} arrow>
                    <Chip size="small" label={o.label}
                      sx={{ height: 19, fontSize: 11, fontWeight: 700, bgcolor: o.bg, color: o.fg, cursor: 'help' }} />
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
        <Typography variant="caption" sx={{ color: '#5a6675' }}>
          A run is recorded even when it finds nothing. That case used to leave no trace at all, so
          &ldquo;we traced that week and got nothing&rdquo; read exactly like &ldquo;nobody has ever traced it&rdquo;.
        </Typography>
      </Stack>
    </Box>
  );
}
