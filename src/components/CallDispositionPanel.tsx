'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Stack, Chip, Button, TextField, Alert, Divider, Tooltip,
} from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import { CALL_OUTCOMES, CALL_STATUS_LABEL, type CallOutcome, type CallStatus } from '@/lib/callOutcomes';

/**
 * Logging a call (directive Sec. 10.5).
 *
 * "A form Ruben completes on a phone in under fifteen seconds. A form, not a spreadsheet
 * row to find and edit — it timestamps automatically and cannot be typed into the wrong
 * record."
 *
 * So: pick the number, tap the outcome, done. Notes and duration are optional and sit
 * after the thing that matters. The outcome buttons carry their consequence in a tooltip
 * because two of them suppress the household, and a control that does something
 * irreversible without saying so will eventually be tapped by someone in a hurry.
 *
 * The history above is the point of the exercise. "Couldn't reach them" is not data;
 * four rows with numbers, days and outcomes is.
 */

type Attempt = {
  id: string; numberDialled: string; numberRole: string | null; numberLabel: string | null;
  attemptedAt: string; durationSeconds: number | null; outcome: CallOutcome;
  callbackAt: string | null; notes: string | null; calledBy: string | null;
};
type State = {
  status: CallStatus; attempts: Attempt[]; attemptCount: number;
  numbersTried: string[]; distinctDays: number; lastAttemptAt: string | null;
  nextCallbackAt: string | null; invalidNumbers: string[];
  dialable: Array<{ number: string; role: 'insured' | 'co_insured'; label: string }>;
  blockedReason: string | null;
};

const fmtPhone = (n: string) => {
  const d = String(n).replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n;
};

const STATUS_STYLE: Record<CallStatus, object> = {
  not_attempted: { bgcolor: '#f1f5f9', color: '#5a6675' },
  attempting: { bgcolor: '#fff3d6', color: '#8a5a00' },
  contacted: { bgcolor: '#e7f5ec', color: '#166534' },
  unreachable: { bgcolor: '#fdecea', color: '#b3261e' },
};

export default function CallDispositionPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [callbackAt, setCallbackAt] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/leads/${leadId}/calls`)).json();
      if (!j.success) throw new Error(j.error || 'Could not read call history');
      setState(j.data);
      setNumber((n) => n || j.data.dialable[0]?.number || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read call history');
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const log = async (outcome: CallOutcome) => {
    const spec = CALL_OUTCOMES.find((o) => o.key === outcome)!;
    if (!number) { setError('Pick the number you dialled.'); return; }
    if (spec.needsCallbackAt && !callbackAt) {
      setError('A scheduled callback needs a date and time.');
      return;
    }
    if (spec.suppresses && !confirm(
      `Log "${spec.label}"?\n\n${spec.follows}\n\n`
      + 'This stops all contact with the household, on every channel. It is recorded, not deleted.',
    )) return;

    setBusy(true); setError(null); setMsg(null);
    try {
      const chosen = state?.dialable.find((d) => d.number === number);
      const j = await (await fetch(`/api/leads/${leadId}/calls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome, numberDialled: number,
          numberRole: chosen?.role ?? null, numberLabel: chosen?.label ?? null,
          notes: notes.trim() || null,
          callbackAt: spec.needsCallbackAt ? callbackAt : null,
        }),
      })).json();
      if (!j.success) throw new Error(j.error || 'Could not log the attempt');
      setState(j.data);
      setNotes(''); setCallbackAt('');
      setMsg(`Logged: ${spec.label}.`
        + (j.numberInvalidated ? ' That number will not be dialled again.' : '')
        + (j.suppressed ? ' Household suppressed.' : '')
        + (j.status === 'unreachable' ? ' This lead is now unreachable by phone and moves to direct mail.' : ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not log the attempt');
    } finally { setBusy(false); }
  };

  if (!state) {
    return <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Loading call history…</Typography></Paper>;
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <PhoneIcon fontSize="small" sx={{ color: '#5a6675' }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Calls</Typography>
        <Chip label={CALL_STATUS_LABEL[state.status]} size="small"
          sx={{ height: 20, fontWeight: 700, ...STATUS_STYLE[state.status] }} />
        {state.attemptCount > 0 && (
          <Tooltip arrow title={
            `${state.attemptCount} attempt${state.attemptCount === 1 ? '' : 's'} across `
            + `${state.numbersTried.length} number${state.numbersTried.length === 1 ? '' : 's'} `
            + `over ${state.distinctDays} day${state.distinctDays === 1 ? '' : 's'}. `
            + 'Unreachable needs 4 attempts, 3+ days and 2+ numbers where they exist.'
          }>
            <Typography variant="caption" sx={{ color: '#5a6675', cursor: 'help' }}>
              {state.attemptCount} attempt{state.attemptCount === 1 ? '' : 's'} ·{' '}
              {state.numbersTried.length} number{state.numbersTried.length === 1 ? '' : 's'} ·{' '}
              {state.distinctDays} day{state.distinctDays === 1 ? '' : 's'}
            </Typography>
          </Tooltip>
        )}
        {state.nextCallbackAt && (
          <Chip size="small" label={`Callback ${new Date(state.nextCallbackAt).toLocaleString()}`}
            sx={{ height: 20, bgcolor: '#e8f0fe', color: '#1565c0', fontWeight: 600 }} />
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg}</Alert>}

      {/*
        Never a silently disabled form. If there is nobody to call — suppressed household,
        every number dead, already retired — the reason is stated, because an unexplained
        dead control gets worked around by dialling off the card, and then the attempt is
        never logged at all.
      */}
      {state.blockedReason ? (
        <Alert severity="warning" sx={{ mb: 1.5 }}>{state.blockedReason}</Alert>
      ) : (
        <>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
            Which number did you dial?
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {state.dialable.map((d) => (
              <Chip
                key={d.number}
                label={`${fmtPhone(d.number)} · ${d.role === 'insured' ? 'insured' : 'co-insured'}`}
                size="small"
                onClick={() => setNumber(d.number)}
                variant={number === d.number ? 'filled' : 'outlined'}
                sx={number === d.number ? { bgcolor: '#1565c0', color: '#fff', fontWeight: 700 } : undefined}
              />
            ))}
          </Stack>

          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
            What happened? One tap — it is timestamped for you.
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {CALL_OUTCOMES.map((o) => (
              <Tooltip key={o.key} arrow title={o.follows}>
                <span>
                  <Button
                    size="small" variant="outlined" disabled={busy}
                    onClick={() => log(o.key)}
                    sx={{
                      fontSize: 11, textTransform: 'none',
                      ...(o.tone === 'bad' ? { borderColor: '#f2a3a3', color: '#b3261e' } : {}),
                      ...(o.tone === 'good' ? { borderColor: '#9bd4b0', color: '#166534' } : {}),
                    }}
                  >
                    {o.label}
                  </Button>
                </span>
              </Tooltip>
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
            <TextField
              size="small" fullWidth placeholder="Notes (optional)"
              value={notes} onChange={(e) => setNotes(e.target.value)}
            />
            <TextField
              size="small" type="datetime-local" label="Callback" sx={{ minWidth: 210 }}
              slotProps={{ inputLabel: { shrink: true } }}
              value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)}
            />
          </Stack>
        </>
      )}

      {state.invalidNumbers.length > 0 && (
        <Typography variant="caption" sx={{ display: 'block', color: '#b3261e', mb: 1 }}>
          Not dialling: {state.invalidNumbers.map(fmtPhone).join(', ')} — marked bad or wrong person.
        </Typography>
      )}

      {state.attempts.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75 }}>
            Every attempt
          </Typography>
          {state.attempts.map((a) => {
            const spec = CALL_OUTCOMES.find((o) => o.key === a.outcome);
            return (
              <Box key={a.id} sx={{ display: 'flex', gap: 1, py: 0.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ minWidth: 118, color: '#5a6675' }}>
                  {new Date(a.attemptedAt).toLocaleString()}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {fmtPhone(a.numberDialled)}
                </Typography>
                <Typography variant="caption" sx={{
                  fontWeight: 700,
                  color: spec?.tone === 'good' ? '#166534' : spec?.tone === 'bad' ? '#b3261e' : '#5a6675',
                }}>
                  {spec?.label ?? a.outcome}
                </Typography>
                {a.notes && <Typography variant="caption" sx={{ color: '#5a6675' }}>· {a.notes}</Typography>}
                {a.calledBy && <Typography variant="caption" sx={{ color: '#9098a6' }}>· {a.calledBy}</Typography>}
              </Box>
            );
          })}
        </>
      )}
    </Paper>
  );
}
