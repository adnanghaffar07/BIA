'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack,
  TextField, Divider, Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useStickyState } from '@/hooks/useStickyState';

/**
 * The workflow board (Frank, 29 Sep 2026).
 *
 * "Both of them work into a workflow dashboard, broken out in boxes by cohort, and you can
 *  click into the box and see emails, anything responding to, follow-ups, callbacks, quote
 *  issued follow-up... That's a real workflow dashboard. You don't miss anything."
 *
 * ── One list, two channels ──────────────────────────────────────────────────
 * A reply and a callback are the same thing to the person holding the phone: somebody is
 * waiting. They arrive through different systems and used to live on different screens, so
 * knowing what was owed meant checking both and remembering the overlap. Here they are one
 * list, and the channel is a label on the row rather than a reason to look somewhere else.
 *
 * ── Nothing here is ticked off ──────────────────────────────────────────────
 * Every row is derived from the lead. A reply stands until somebody rings, a callback until
 * the next attempt, a quote until it binds or is lost. There is deliberately no "done"
 * button: the first item somebody marked done without doing it would make the whole board
 * worth ignoring, and this is the screen that is supposed to be trusted.
 */

type ActionKind = 'reply' | 'callback' | 'reminder' | 'quote_requested' | 'quote_stale';

type Item = {
  leadId: string; propertyId: string | null; cohort: string | null;
  kind: ActionKind; detail: string | null;
  owner: string | null; address: string | null; phone: string | null;
  effectiveDate: string | null; since: string | null;
  ageDays: number; overdue: boolean;
};

type Box = {
  cohort: string; code: string | null; label: string; endsOn: string | null;
  total: number; overdue: number; byKind: Record<ActionKind, number>; oldestDays: number;
};

type Board = { boxes: Box[]; items: Item[]; totals: { total: number; overdue: number; byKind: Record<ActionKind, number> } };

/**
 * What each row means, and who it is waiting on — in the words somebody would use out loud.
 * The key names are for the database; nobody reading this board should meet them.
 */
const KIND: Record<ActionKind, { label: string; colour: string; short: string }> = {
  reply:           { label: 'Replied to an email',     colour: '#1b6b2f', short: 'Replies' },
  callback:        { label: 'Callback due',            colour: '#1565c0', short: 'Callbacks' },
  reminder:        { label: 'Reminder due',            colour: '#5a6675', short: 'Reminders' },
  quote_requested: { label: 'Quote asked for',         colour: '#8a5a00', short: 'Quotes owed' },
  quote_stale:     { label: 'Quote sent, no reply',    colour: '#b3261e', short: 'Quotes quiet' },
};

/** Ten digits as a producer reads them out. Anything else is left exactly as stored. */
const fmtPhone = (n: string) => {
  const d = String(n).replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n;
};

export default function WorkflowPage() {
  const [effFrom, setEffFrom] = useStickyState('workflow:from', '2026-10-05');
  const [effTo, setEffTo] = useStickyState('workflow:to', '2026-11-29');
  /** Which box is open. Empty means every cohort at once. */
  const [openCohort, setOpenCohort] = useStickyState('workflow:cohort', '');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Only the newest request paints — the sticky filters above restore in an effect, so a
   * visit fires one request for the defaults and a second for the saved dates. Without this
   * the slower one wins and the board describes a window nobody is looking at.
   */
  const wanted = useRef(0);

  const load = useCallback(async () => {
    const mine = ++wanted.current;
    setLoading(true); setError(null);
    try {
      const u = new URL('/api/admin/workflow', window.location.origin);
      if (effFrom) u.searchParams.set('effFrom', effFrom);
      if (effTo) u.searchParams.set('effTo', effTo);
      const j = await (await fetch(u.toString())).json();
      if (mine !== wanted.current) return;
      if (!j.success) throw new Error(j.error || 'Could not build the board');
      setBoard(j as Board);
    } catch (e) {
      if (mine !== wanted.current) return;
      setError(e instanceof Error ? e.message : 'Could not build the board');
    } finally {
      if (mine === wanted.current) setLoading(false);
    }
  }, [effFrom, effTo]);

  useEffect(() => { void load(); }, [load]);

  const shown = board?.items.filter((i) => !openCohort || i.cohort === openCohort) ?? [];

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>What needs doing</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Everything a homeowner is waiting on, from the phone and the email campaign together.
        A row disappears when the work is done — there is nothing to tick off.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <TextField
            size="small" type="date" label="Renewals from" value={effFrom}
            onChange={(e) => setEffFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small" type="date" label="Renewals to" value={effTo}
            onChange={(e) => setEffTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Tooltip title="Reload">
            <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </Button>
          </Tooltip>
          {!!board?.totals.total && (
            <Typography variant="body2" sx={{ ml: 1 }}>
              <b>{board.totals.total}</b> outstanding
              {board.totals.overdue > 0 && (
                <Box component="span" sx={{ color: '#b3261e', fontWeight: 700 }}>
                  {' · '}{board.totals.overdue} behind
                </Box>
              )}
            </Typography>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {!loading && !board?.boxes.length && (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h6">Nothing outstanding</Typography>
          <Typography color="text.secondary">
            Nobody is waiting on a reply, a callback or a quote in this window.
          </Typography>
        </Paper>
      )}

      {/* ── The boxes, one per renewal week ──────────────────────────────── */}
      {!loading && !!board?.boxes.length && (
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', mb: 3 }} useFlexGap>
          {board.boxes.map((b) => {
            const active = openCohort === b.cohort;
            return (
              <Paper
                key={b.cohort}
                variant="outlined"
                onClick={() => setOpenCohort(active ? '' : b.cohort)}
                sx={{
                  p: 2, minWidth: 190, cursor: 'pointer',
                  borderColor: active ? '#1565c0' : b.overdue ? '#e6b3ad' : undefined,
                  borderWidth: active ? 2 : 1,
                  bgcolor: active ? '#f3f8ff' : b.overdue ? '#fffafa' : undefined,
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#5a6675' }}>
                  {b.code ?? b.cohort} · {b.label}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1, mt: 0.5 }}>
                  {b.total}
                </Typography>
                {b.overdue > 0 && (
                  <Typography variant="caption" sx={{ color: '#b3261e', fontWeight: 700, display: 'block' }}>
                    {b.overdue} behind · oldest {b.oldestDays}d
                  </Typography>
                )}
                <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }} useFlexGap>
                  {/*
                    Named by KIND, not by channel.

                    Three of the five kinds arrive by phone, so labelling the chips with the
                    channel produced a box reading "Phone 1  Phone 2" — two chips, same word,
                    different things, and no way to tell a callback from a quote somebody is
                    owed. The chip has to say what the work IS.
                  */}
                  {(Object.keys(KIND) as ActionKind[]).filter((k) => b.byKind[k]).map((k) => (
                    <Chip
                      key={k} size="small" variant="outlined"
                      label={`${KIND[k].short} ${b.byKind[k]}`}
                      sx={{ height: 20, fontSize: 11, borderColor: KIND[k].colour, color: KIND[k].colour }}
                    />
                  ))}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* ── The list ─────────────────────────────────────────────────────── */}
      {!loading && !!shown.length && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {openCohort
              ? `${board!.boxes.find((b) => b.cohort === openCohort)?.code ?? openCohort} — ${shown.length} to do`
              : `Everything, soonest renewal first — ${shown.length} to do`}
            {openCohort && (
              <Button size="small" sx={{ ml: 1 }} onClick={() => setOpenCohort('')}>show all weeks</Button>
            )}
          </Typography>

          {shown.map((i, idx) => (
            <Box key={`${i.leadId}-${i.kind}-${idx}`}>
              {idx > 0 && <Divider sx={{ my: 1 }} />}
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                sx={{ py: 0.75, alignItems: { md: 'center' }, justifyContent: 'space-between' }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                    <Chip
                      size="small" label={KIND[i.kind].label}
                      sx={{ height: 21, fontSize: 11, fontWeight: 700, bgcolor: KIND[i.kind].colour, color: '#fff' }}
                    />
                    {/*
                      The clock, and Frank's two-day line. Shown as a number of days rather
                      than a date because the question is "how long have they been waiting",
                      and nobody does that subtraction in their head at speed.
                    */}
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: i.overdue ? '#b3261e' : '#5a6675' }}
                    >
                      {i.ageDays === 0 ? 'today' : `${i.ageDays}d`}{i.overdue ? ' — behind' : ''}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#8a8f98' }}>
                      renews {i.effectiveDate ?? '—'}
                    </Typography>
                  </Stack>
                  <Typography sx={{ mt: 0.25 }}>
                    <Box
                      component="a" href={`/leads/${i.leadId}`} target="_blank" rel="noopener"
                      sx={{ fontWeight: 700 }}
                    >
                      {i.owner || 'Unknown owner'}
                    </Box>
                    <Box component="span" sx={{ color: '#5a6675' }}>
                      {' — '}{i.address ?? 'no address'}
                    </Box>
                    {/*
                      Dialable, because this board exists to be acted on.

                      It showed a raw ten-digit string, which is neither readable at a glance
                      nor usable — the producer reading this row wants to ring the person on
                      it, and copying digits out of a sentence is the friction that sends him
                      back to the phone queue to find the same lead again.
                    */}
                    {i.phone && (
                      <Box
                        component="a" href={`tel:${String(i.phone).replace(/\D/g, '')}`}
                        sx={{ ml: 1, fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        {fmtPhone(i.phone)}
                      </Box>
                    )}
                  </Typography>
                  {i.detail && (
                    <Typography variant="caption" sx={{ color: '#3d4658', display: 'block' }}>
                      “{i.detail}”
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
    </Container>
  );
}
