'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Snackbar, Alert, Button, Stack, Typography } from '@mui/material';
import Link from 'next/link';

/**
 * Tells whoever is calling when a reminder falls due, wherever they are in the CRM.
 *
 * ── Why it lives in the layout ──────────────────────────────────────────────
 * The reminder exists because Ruben rang a number, nobody answered, and he wants another go
 * in fifteen minutes. He will not be sitting on that lead's page when the fifteen minutes
 * are up — he will be on the next one. A notice that only appears on the page that created
 * it is a notice nobody sees.
 *
 * ── Why polling, and why sixty seconds ──────────────────────────────────────
 * There is no socket in this app and one reminder every few minutes does not justify
 * building one. Sixty seconds is the resolution of the thing being scheduled: a reminder is
 * set in whole minutes, so a minute late is within the granularity of the request itself.
 *
 * ── Why it does not ask for browser notifications ───────────────────────────
 * A permission prompt on page load, for something that has not happened yet, is the prompt
 * everybody blocks — and once blocked it cannot be asked again. An in-app toast always
 * works, needs no permission, and cannot be silently switched off by a browser setting
 * nobody remembers changing.
 */

type Reminder = {
  id: string;
  leadId: string;
  propertyId: string | null;
  phone: string | null;
  dueLabel: string;
  minutesUntil: number;
  owner: string | null;
  address: string | null;
  note: string | null;
};

const POLL_MS = 60_000;

export default function CallReminderWatcher() {
  const [due, setDue] = useState<Reminder | null>(null);
  /**
   * Reminders already shown, so one falling due does not reopen the toast every minute
   * until it is closed. Cleared only by the page reloading, which is the right lifetime —
   * a reminder dismissed in one session should be offered again in the next if it is still
   * open, because it still has not been called.
   */
  const shown = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/call-reminders?due=1&limit=5');
      if (!res.ok) return;
      const j = await res.json();
      if (!j.success) return;
      const next = (j.reminders as Reminder[] | undefined)?.find((r) => !shown.current.has(r.id));
      if (next) {
        shown.current.add(next.id);
        setDue(next);
      }
    } catch { /* a failed poll is not worth telling anybody about; the next one is 60s away */ }
  }, []);

  useEffect(() => {
    let alive = true;
    // A first check on mount, so opening the CRM with something already overdue says so
    // rather than waiting a minute to mention it.
    const tick = () => { if (alive) void poll(); };
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [poll]);

  const close = async (how: 'done' | 'dismissed') => {
    const r = due;
    setDue(null);
    if (!r) return;
    try {
      await fetch('/api/call-reminders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: r.id, how }),
      });
    } catch { /* it stays open and comes round again, which is the safe direction */ }
  };

  if (!due) return null;

  const late = due.minutesUntil < -1 ? ` · ${Math.abs(due.minutesUntil)} min ago` : '';

  return (
    <Snackbar
      open
      /*
        Top right, not bottom.
        Bottom right is where this app puts nothing else, but it is also where the call list
        runs to — on the phone screen the toast landed over the last rows of the queue,
        which is exactly what somebody is reading when a reminder fires.
      */
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      // No autoHideDuration. A reminder that disappears on its own is one somebody misses
      // while they are on a call — which is exactly when it will fire.
      sx={{ maxWidth: 420, mt: { xs: 7, md: 2 } }}
    >
      <Alert severity="info" icon={false} sx={{ width: '100%', border: '1px solid #1a3d7c' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Call reminder{late}
        </Typography>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {due.owner ?? 'Lead'}{due.phone ? ` · ${due.phone}` : ''}
        </Typography>
        {due.address && (
          <Typography variant="caption" sx={{ display: 'block', color: '#5a6675' }}>
            {due.address}
          </Typography>
        )}
        {due.note && (
          <Typography variant="caption" sx={{ display: 'block', color: '#5a6675', fontStyle: 'italic' }}>
            “{due.note}”
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {/*
            Opens the card and leaves the reminder OPEN. It closes when an outcome is
            logged — so a reminder shown as called always has a call behind it.
          */}
          <Button
            size="small"
            variant="contained"
            component={Link}
            href={`/leads/${due.leadId}?call=${encodeURIComponent(due.phone ?? '')}`}
            onClick={() => setDue(null)}
          >
            Call now
          </Button>
          <Button size="small" onClick={() => close('dismissed')}>Not now</Button>
        </Stack>
      </Alert>
    </Snackbar>
  );
}
