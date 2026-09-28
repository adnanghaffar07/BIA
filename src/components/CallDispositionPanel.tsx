'use client';

import { easternDisplay } from '@/lib/wallClock';
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
  dialable: Array<{
    number: string; role: 'insured' | 'co_insured'; label: string;
    /** From the skip-trace payload. 48% of C1–C3 numbers are DNC-flagged. */
    dnc?: boolean; tcpa?: boolean; rank?: number | null; type?: string | null;
  }>;
  blockedReason: string | null;
};

const fmtPhone = (n: string) => {
  const d = String(n).replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n;
};

/**
 * One colour per status, and the four that replaced "contacted" are deliberately not all
 * green. Reaching somebody is not the outcome — what they said is. A do-not-call and a
 * quote request are both "contacted" and belong at opposite ends of the queue.
 */
const STATUS_STYLE: Record<CallStatus, object> = {
  not_attempted: { bgcolor: '#f1f5f9', color: '#5a6675' },
  attempting: { bgcolor: '#fff3d6', color: '#8a5a00' },
  callback_due: { bgcolor: '#e8f0fe', color: '#1565c0' },
  quoting: { bgcolor: '#e7f5ec', color: '#166534' },
  not_interested: { bgcolor: '#f1f5f9', color: '#5a6675' },
  do_not_call: { bgcolor: '#fdecea', color: '#b3261e' },
  unreachable: { bgcolor: '#fdecea', color: '#b3261e' },
};

export default function CallDispositionPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState<string>('');
  const [notes, setNotes] = useState('');
  /**
   * Addresses taken mid-call (Frank, 25 Sep 2026 · item 8).
   *
   * Held here rather than on the card's edit form because the moment they exist is while
   * somebody is on the phone — and loading, editing and re-saving a whole lead to record
   * one line a customer just read out is not something anyone does with a person waiting.
   */
  const [capIns, setCapIns] = useState('');
  const [capCo, setCapCo] = useState('');
  const [capOpen, setCapOpen] = useState(false);
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

    /**
     * Clear the previous result BEFORE validating.
     *
     * Frank, 25 Sep 2026: "A callback saved without a date. Both the error banner and
     * 'Logged' showed."
     *
     * The guards below already refused the save — nothing was written. What stayed on
     * screen was the success message from the PREVIOUS attempt, because setMsg(null) came
     * after the early returns. So a refused save looked like a completed one sitting next
     * to a complaint, and the operator is left to guess which is true. On a callback that
     * means believing Ruben has a date in the diary when he has nothing.
     */
    setMsg(null);
    setError(null);

    if (!number) { setError('Pick the number you dialled.'); return; }
    if (spec.needsCallbackAt && !callbackAt) {
      setError('A scheduled callback needs a date and time.');
      return;
    }
    /**
     * A callback in the past is a callback nobody will be reminded about — the panel only
     * surfaces ones still ahead. Refused rather than accepted quietly.
     */
    if (spec.needsCallbackAt && new Date(callbackAt).getTime() <= Date.now()) {
      setError('That callback time has already passed. Pick a time in the future.');
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

  /**
   * Take back the last outcome (Frank's item 9).
   *
   * Frank's example: one number showing "Voicemail left" and then "Bad number" five seconds
   * later. Without this the only way to correct a mis-tap is to log a third outcome on top,
   * which leaves the wrong one in the history looking like something that happened.
   */
  const undoLast = async () => {
    setMsg(null); setError(null);
    setBusy(true);
    try {
      const j = await (await fetch(`/api/leads/${leadId}/calls/undo`, { method: 'POST' })).json();
      if (!j.success) throw new Error(j.error || 'Could not undo that');
      if (!j.undone) { setError(j.reason || 'Nothing to undo.'); return; }
      setState(j.data);
      setMsg('Last outcome undone. Anything it triggered has been reversed too.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not undo that');
    } finally { setBusy(false); }
  };

  const captureEmail = async () => {
    setMsg(null); setError(null);
    if (!capIns.trim() && !capCo.trim()) { setError('Type at least one address.'); return; }
    setBusy(true);
    try {
      const j = await (await fetch(`/api/leads/${leadId}/capture-email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insuredEmail: capIns.trim() || null,
          coInsuredEmail: capCo.trim() || null,
        }),
      })).json();
      if (!j.success) throw new Error(j.error || 'Could not save that address');
      setState(j.data);
      setCapIns(''); setCapCo(''); setCapOpen(false);
      setMsg(
        `Saved${j.insuredSet ? ' insured' : ''}${j.insuredSet && j.coInsuredSet ? ' and' : ''}`
        + `${j.coInsuredSet ? ' co-insured' : ''} address. This account is now reachable by email.`
        + (j.replaced?.length
          ? ` The previous ${j.replaced.map((r: { role: string; was: string }) => `${r.role} address (${r.was})`).join(' and ')} is in the history.`
          : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that address');
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
          <Chip size="small" label={`Callback ${easternDisplay(state.nextCallbackAt)} ET`}
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
            Which number did you dial? <Box component="span" sx={{ fontWeight: 400, color: '#5a6675' }}>
              — best first
            </Box>
          </Typography>
          {/*
            ── DNC, shown on the number (Frank's item 9) ──────────────────────

            The skip-trace payload has carried a per-number DNC flag all along and none of
            it reached the person dialling: 464 of the 965 numbers on C1–C3 cards are
            flagged, on 155 of 184 accounts, and 16 accounts are flagged on every number.

            Flagged numbers are sorted last and marked, not removed. Removing them would
            hide half the list and make 16 accounts look as though they had no numbers at
            all; leaving them unmarked is how somebody dials one without knowing. Whether a
            flagged number may be called is a question for Frank and Adnan — the panel's job
            is to make sure nobody answers it by accident.
          */}
          <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {state.dialable.map((d) => (
              <Tooltip
                key={d.number}
                arrow
                title={[
                  d.role === 'insured' ? 'The insured' : 'The co-insured',
                  d.label === 'trace' ? 'found by a skip trace' : 'on the policy record',
                  d.type ? d.type.toLowerCase() : null,
                  d.rank != null ? `vendor rank ${d.rank}` : null,
                  d.dnc ? 'ON THE DO-NOT-CALL LIST' : null,
                ].filter(Boolean).join(' · ')}
              >
                <Chip
                  label={`${fmtPhone(d.number)}${d.dnc ? ' · DNC' : ''}`}
                  size="small"
                  onClick={() => setNumber(d.number)}
                  variant={number === d.number ? 'filled' : 'outlined'}
                  sx={number === d.number
                    ? { bgcolor: d.dnc ? '#b3261e' : '#1565c0', color: '#fff', fontWeight: 700 }
                    : d.dnc
                      ? { borderColor: '#b3261e', color: '#b3261e', fontWeight: 700 }
                      : undefined}
                />
              </Tooltip>
            ))}
          </Stack>
          {state.dialable.some((d) => d.dnc) && (
            <Typography variant="caption" sx={{ display: 'block', color: '#b3261e', mb: 1.5 }}>
              {state.dialable.filter((d) => d.dnc).length} of these {state.dialable.length} numbers
              are on the do-not-call list. They are listed last and flagged — check before dialling one.
            </Typography>
          )}

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
              value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)}
              required
              error={Boolean(error) && !callbackAt}
              slotProps={{
                inputLabel: { shrink: true },
                /**
                 * Nothing before now. The panel only ever surfaces callbacks still ahead,
                 * so a past one is recorded and then never shown to anybody — which is
                 * indistinguishable from not having set one.
                 */
                htmlInput: {
                  min: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
                    .toISOString().slice(0, 16),
                },
              }}
            />
          </Stack>
        </>
      )}

      {/*
        ── An address, taken on the call (Frank's item 8) ────────────────────

        Aimed at the 72 rated C1–C3 accounts with no verified address, which Ruben calls
        first precisely because we cannot email them. The one thing that call can produce
        that nothing else can is the address itself, said out loud by the person it belongs
        to — better evidence than a skip trace, a tax roll or a verifier, all of which are
        guesses about who owns a mailbox.

        Collapsed by default so it does not compete with the outcome buttons, which are what
        the panel is for.
      */}
      <Box sx={{ mb: 1.5 }}>
        {!capOpen ? (
          <Button size="small" variant="text" onClick={() => setCapOpen(true)} sx={{ pl: 0 }}>
            + Add an email they gave you
          </Button>
        ) : (
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#fafbfc' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
              An address from the call
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              <TextField
                size="small" label="Insured email" type="email" sx={{ flex: '1 1 220px' }}
                value={capIns} onChange={(e) => setCapIns(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                placeholder="name@example.com"
              />
              <TextField
                size="small" label="Co-insured email" type="email" sx={{ flex: '1 1 220px' }}
                value={capCo} onChange={(e) => setCapCo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                placeholder="optional"
              />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center' }}>
              <Button size="small" variant="contained" disabled={busy} onClick={captureEmail}>
                Save address
              </Button>
              <Button size="small" onClick={() => { setCapOpen(false); setCapIns(''); setCapCo(''); }}>
                Cancel
              </Button>
              <Typography variant="caption" sx={{ color: '#5a6675' }}>
                Taken from the customer, so it outranks anything a trace found.
              </Typography>
            </Stack>
          </Paper>
        )}
      </Box>

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
          {/*
            Undo sits on the newest row only, and only inside the window the service
            allows. A button on every row would invite editing history; this is for the
            five seconds after a wrong tap.
          */}
          {state.attempts.map((a, idx) => {
            const spec = CALL_OUTCOMES.find((o) => o.key === a.outcome);
            return (
              <Box key={a.id} sx={{ display: 'flex', gap: 1, py: 0.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ minWidth: 118, color: '#5a6675' }}>
                  {/*
                    Eastern, always — not the reader's own clock.

                    This was toLocaleString() on a value the browser parsed as local, so a
                    call placed at 12:42 AM in New Jersey showed as 4:42 AM. Frank, 25 Sep:
                    "calling-hours rules and day counts depend on it." Whoever opens the
                    card, the agency operates on Eastern and the log has to say Eastern.
                  */}
                  {easternDisplay(a.attemptedAt)}
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
                {/*
                  The callback date, on the row that created it (Frank's item 1).

                  Without it the log says a callback was scheduled and not for when, so the
                  only way to find the date was to trust the one chip at the top — which
                  shows the NEXT callback across the whole lead, not this row's.
                */}
                {a.callbackAt && (
                  <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600 }}>
                    · due {easternDisplay(a.callbackAt)} ET
                  </Typography>
                )}
                {a.notes && <Typography variant="caption" sx={{ color: '#5a6675' }}>· {a.notes}</Typography>}
                {a.calledBy && <Typography variant="caption" sx={{ color: '#9098a6' }}>· {a.calledBy}</Typography>}
                {idx === 0 && (
                  <Button size="small" variant="text" disabled={busy} onClick={undoLast}
                    sx={{ minWidth: 0, py: 0, px: 0.75, fontSize: 11, color: "#b3261e" }}>
                    undo
                  </Button>
                )}
              </Box>
            );
          })}
        </>
      )}
    </Paper>
  );
}
