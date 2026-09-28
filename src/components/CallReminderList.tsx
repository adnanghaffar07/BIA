'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Paper, Typography, Stack, Chip, Button, Box, Divider, CircularProgress,
} from '@mui/material';
import AlarmIcon from '@mui/icons-material/AccessAlarm';
import Link from 'next/link';

/**
 * Call reminders, and the record of the ones already dealt with.
 *
 * ── Why it never hides ──────────────────────────────────────────────────────
 * The first version returned null when nothing was pending, on the reasoning that an empty
 * panel wastes the top of the screen. That was wrong in a way that matters: a section which
 * is sometimes absent cannot be relied on, and somebody who set a reminder and then sees no
 * panel has no way to tell "nothing is due" from "it did not save". A fixed place that says
 * "nothing pending" is worth more than the space it costs.
 *
 * ── Why the closed ones stay ────────────────────────────────────────────────
 * A queue that empties itself as it is worked leaves no evidence the work happened. The
 * closed reminders are the record of the shift — what was called back, what was dropped,
 * when and by whom — and they are the only place that record exists: a dropped reminder
 * writes no CallAttempt, because no call was made.
 *
 * ── Why 'called' and 'dropped' stay distinguishable ─────────────────────────
 * Both close a reminder and only one is work done. Collapsing them would leave a log that
 * says how much of the queue stopped being shown, not how much of it got worked.
 */

type Reminder = {
  id: string;
  leadId: string;
  phone: string | null;
  dueLabel: string;
  minutesUntil: number;
  owner: string | null;
  address: string | null;
  note: string | null;
  createdBy: string | null;
  closed: 'called' | 'dropped' | null;
  closedLabel: string | null;
  closedBy: string | null;
};

type Counts = { open: number; due: number; calledToday: number; droppedToday: number };

const EMPTY: Counts = { open: 0, due: 0, calledToday: 0, droppedToday: 0 };

export default function CallReminderList({ onCounts }: {
  /**
   * Reports the counts upward so a tab can badge the due number.
   *
   * Passed up rather than fetched again by the parent: two pollers on the same endpoint
   * would drift a minute apart, and the badge saying 1 while the list shows 2 is the kind
   * of disagreement nobody can explain from the screen.
   */
  onCounts?: (c: Counts) => void;
} = {}) {
  const [rows, setRows] = useState<Reminder[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  /**
   * Held in a ref so the poll effect does not depend on it.
   *
   * The parent passes an inline arrow, which is a new function every render — listing it as
   * a dependency would tear down and restart the sixty-second poll on each one, and the
   * reminder that fell due in between would simply never be fetched.
   */
  const onCountsRef = useRef(onCounts);
  // Assigned in an effect, not during render: a ref written while rendering is a side
  // effect in the render path, and React flags it for good reason — under concurrent
  // rendering a render that gets thrown away would still have moved it.
  useEffect(() => { onCountsRef.current = onCounts; }, [onCounts]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const j = await (await fetch('/api/call-reminders?log=1&limit=60')).json();
        if (alive && j.success) {
          setRows(j.reminders ?? []);
          setCounts(j.counts ?? EMPTY);
          onCountsRef.current?.(j.counts ?? EMPTY);
        }
      } catch { /* the call queue below is the point of this page; this must not break it */ }
      finally { if (alive) setLoading(false); }
    };
    void tick();
    // Minute resolution, matching what is being scheduled: reminders are set in whole
    // minutes, so a minute late is inside the granularity of the request itself.
    const t = setInterval(() => { void tick(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const close = async (id: string, how: 'done' | 'dismissed') => {
    // Moved rather than removed: it belongs in the log now, and a row that vanishes on a
    // click leaves somebody unsure whether it registered.
    setRows((p) => p.map((r) => (r.id === id
      ? { ...r, closed: 'dropped', closedLabel: 'just now' }
      : r)));
    try {
      await fetch('/api/call-reminders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, how }),
      });
    } finally {
      const j = await (await fetch('/api/call-reminders?log=1&limit=60')).json();
      if (j.success) { setRows(j.reminders ?? []); setCounts(j.counts ?? EMPTY); onCountsRef.current?.(j.counts ?? EMPTY); }
    }
  };

  const open = rows.filter((r) => !r.closed);
  const done = rows.filter((r) => r.closed);

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 2, borderColor: counts.due ? '#b3261e' : '#e3e6ea', bgcolor: counts.due ? '#fffafa' : '#fff' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <AlarmIcon sx={{ color: counts.due ? '#b3261e' : '#5a6675', fontSize: 20 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Call reminders</Typography>
        {counts.due > 0 && (
          <Chip size="small" label={`${counts.due} due now`}
            sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: '#fdecea', color: '#b3261e' }} />
        )}
        {counts.open - counts.due > 0 && (
          <Chip size="small" label={`${counts.open - counts.due} later`}
            sx={{ height: 20, fontSize: 11, bgcolor: '#eef4ff', color: '#1a3d7c' }} />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" sx={{ color: '#5a6675' }}>
          last 24h: {counts.calledToday} called · {counts.droppedToday} dropped
        </Typography>
        {loading && <CircularProgress size={14} />}
      </Stack>

      {!loading && !open.length && (
        <Typography variant="body2" sx={{ color: '#8a8f98', py: 0.5 }}>
          Nothing pending. Set one from a lead&apos;s Calls card when a number rings out.
        </Typography>
      )}

      {open.map((r, i) => {
        const overdue = r.minutesUntil <= 0;
        return (
          <Box key={r.id}>
            {i > 0 && <Divider sx={{ my: 0.75 }} />}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Chip
                size="small"
                label={overdue
                  ? (r.minutesUntil < -1 ? `${Math.abs(r.minutesUntil)} min ago` : 'due now')
                  : `in ${r.minutesUntil} min`}
                sx={{
                  height: 20, fontSize: 11, fontWeight: 700, minWidth: 82,
                  bgcolor: overdue ? '#fdecea' : '#eef4ff',
                  color: overdue ? '#b3261e' : '#1a3d7c',
                }}
              />
              <Box sx={{ minWidth: 200 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {r.owner ?? 'Lead'}{r.phone ? ` · ${r.phone}` : ''}
                </Typography>
                <Typography variant="caption" sx={{ color: '#5a6675' }}>
                  {r.address ?? ''}{r.address && r.note ? ' · ' : ''}
                  {r.note ? <em>“{r.note}”</em> : ''}
                </Typography>
              </Box>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="caption" sx={{ color: '#8a8f98' }}>
                {r.dueLabel}{r.createdBy ? ` · ${r.createdBy}` : ''}
              </Typography>
              {/*
                "Call now" opens the card with this number selected — it does NOT close the
                reminder. The reminder closes when an OUTCOME is logged, so the log can only
                say "called" if a call actually exists. The button that used to sit here
                closed it directly, which left the reminder log and the lead's call history
                telling different stories.
              */}
              <Button
                size="small"
                variant="contained"
                component={Link}
                href={`/leads/${r.leadId}?call=${encodeURIComponent(r.phone ?? '')}`}
              >
                Call now
              </Button>
              <Button size="small" sx={{ color: '#8a8f98' }} onClick={() => close(r.id, 'dismissed')}>Drop</Button>
            </Stack>
          </Box>
        );
      })}

      {done.length > 0 && (
        <>
          <Divider sx={{ my: 1.25 }} />
          <Button
            size="small"
            variant="text"
            onClick={() => setShowLog((v) => !v)}
            sx={{ pl: 0, textTransform: 'none', color: '#5a6675' }}
          >
            {showLog ? 'Hide' : 'Show'} the log — {done.length} dealt with
          </Button>

          {showLog && (
            <Box sx={{ mt: 0.5 }}>
              {done.map((r) => (
                <Stack
                  key={r.id}
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, py: 0.35 }}
                >
                  {/*
                    Called and dropped are coloured apart. A log where both read the same
                    says how much of the queue stopped being shown, not how much got worked.
                  */}
                  <Chip
                    size="small"
                    label={r.closed === 'called' ? 'called' : 'dropped'}
                    sx={{
                      height: 19, fontSize: 11, fontWeight: 700, minWidth: 66,
                      bgcolor: r.closed === 'called' ? '#e7f4ea' : '#f1f3f4',
                      color: r.closed === 'called' ? '#1b6b2f' : '#8a8f98',
                    }}
                  />
                  <Typography variant="caption" sx={{ minWidth: 200, color: '#3d4658' }}>
                    {r.owner ?? 'Lead'}{r.phone ? ` · ${r.phone}` : ''}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Typography variant="caption" sx={{ color: '#8a8f98' }}>
                    {r.closedLabel}{r.closedBy ? ` · ${r.closedBy}` : ''}
                  </Typography>
                  <Button size="small" variant="text" component={Link} href={`/leads/${r.leadId}`}
                    sx={{ minWidth: 0, px: 0.75 }}>
                    open
                  </Button>
                </Stack>
              ))}
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}
