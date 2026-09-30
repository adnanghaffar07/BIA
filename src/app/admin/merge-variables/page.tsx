'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, CircularProgress, Alert, Stack,
  TextField, Divider, IconButton, Tooltip,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';

/**
 * Merge variables whose value is the same for every homeowner.
 *
 * ── What belongs here, and what does not ────────────────────────────────────
 * Three kinds of variable turn up in the email copy, and only one of them can have a value
 * typed for it.
 *
 *   the same for everyone   agency_website, office_address — this screen
 *   different per homeowner renewal_date, town, band_low — built from each lead's record
 *   different per mailbox   producer licence, direct line — the sending signature
 *
 * The middle one is the dangerous one. A renewal date typed once and sent to every household
 * reads perfectly and is wrong for all but one of them, which is worse than the blank it
 * replaced — a blank is visibly broken and somebody fixes it. The server refuses any name
 * the per-lead builder already produces, so that mistake cannot be made by typing.
 */

type Variable = {
  name: string; value: string; description: string | null;
  updatedAt: string | null; updatedBy: string | null;
};

export default function MergeVariablesPage() {
  const [vars, setVars] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Edits in progress, so a field can be changed without saving on every keystroke. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newVar, setNewVar] = useState({ name: '', value: '', description: '' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/merge-variables')).json();
      if (!j.success) throw new Error(j.error || 'Could not load them');
      setVars(j.variables as Variable[]);
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load them');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * ── Getting the values onto the contacts ─────────────────────────────────
   *
   * The sending platform has no workspace-level variable. A merge field resolves from the
   * CONTACT it is sending to and nowhere else, so a value set here does not exist over there
   * until it has been written onto each contact — and custom_variables are written when a
   * contact is created and never again, so anyone already uploaded never receives it.
   *
   * Hence a button rather than something that happens on save: it is ~1,500 API calls across
   * the book, which is far too slow to run every time somebody edits a field, and far too
   * important to run invisibly.
   */
  const [push, setPush] = useState<{
    campaigns: number; contacts: number; upToDate: number; pending: number; variables: string[];
  } | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const checkPush = useCallback(async () => {
    try {
      const j = await (await fetch('/api/admin/merge-variables/push')).json();
      if (j.success) setPush(j);
    } catch { /* the screen is still usable without the count */ }
  }, []);

  useEffect(() => { void checkPush(); }, [checkPush, vars]);

  const runPush = async () => {
    setPushing(true); setPushMsg(null); setError(null);
    let done = 0, failed = 0;
    try {
      // Bounded: each call reports what is left, and a run that stops making progress ends
      // rather than spinning against a platform that has started refusing writes.
      for (let guard = 0; guard < 200; guard++) {
        const j = await (await fetch('/api/admin/merge-variables/push?chunk=25', { method: 'POST' })).json();
        if (!j.success) throw new Error(j.error || 'The push stopped');
        done += j.updated ?? 0;
        failed += (j.failed ?? []).length;
        setPushMsg(`Updating contacts… ${done} done${failed ? `, ${failed} failed` : ''}`);
        if (!j.processed) break;
        if (!j.remaining) break;
      }
      setPushMsg(
        `${done} contact(s) updated${failed ? ` · ${failed} did not take` : ''}. `
        + 'Every campaign now carries these values.',
      );
      await checkPush();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The push stopped');
      setPushMsg(null);
    } finally { setPushing(false); }
  };

  const save = async (name: string, value: string, description?: string | null) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const j = await (await fetch('/api/admin/merge-variables', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value, description }),
      })).json();
      if (!j.success) throw new Error(j.error || 'Could not save that');
      setVars(j.variables as Variable[]);
      setDraft((d) => { const n = { ...d }; delete n[name]; return n; });
      setAdding(false); setNewVar({ name: '', value: '', description: '' });
      setMsg(`Saved. Every email that uses {{${name}}} will carry this from the next send.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally { setBusy(false); }
  };

  const remove = async (name: string) => {
    if (!confirm(
      `Remove {{${name}}}?\n\nAny email copy still using it will send with a blank where it was.`,
    )) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const j = await (await fetch(`/api/admin/merge-variables?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })).json();
      if (!j.success) throw new Error(j.error || 'Could not remove that');
      setVars(j.variables as Variable[]);
      setMsg(`Removed {{${name}}}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that');
    } finally { setBusy(false); }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>Email variables</Typography>
      <Typography color="text.secondary" sx={{ mb: 1 }}>
        Values that are the same in every email, for every homeowner. Set one here and it is sent
        with every contact, so the copy can use it as <code>{'{{name}}'}</code>.
      </Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        Things that change per homeowner — the renewal date, the town, the band price — are not
        set here. They are built from each lead&apos;s own record, and a single value typed for
        them would go to everybody.
      </Alert>

      {/*
        Offered only when there is something to carry and somebody to carry it to.

        A button that writes to every contact on the platform should not sit there inviting a
        hopeful press — it appears when a specific number of contacts are behind, and says
        what that number is before anything is written.
      */}
      {!!push?.pending && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: '#e0b84c', bgcolor: '#fffdf5' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {push.pending} contact{push.pending === 1 ? '' : 's'} on the sending platform
            {push.pending === 1 ? ' does not' : ' do not'} have these values yet
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', color: '#5a6675', mb: 1.5 }}>
            The platform has no shared variable of its own — a value only exists where it has
            been written onto each contact, and a contact keeps whatever it was created with.
            So anyone uploaded before you set {push.variables.length === 1 ? 'this' : 'these'}{' '}
            would still receive a blank.
            {push.upToDate > 0 && ` ${push.upToDate} already have them and will be left alone.`}
          </Typography>
          <Button
            size="small" variant="contained" color="warning" disabled={pushing}
            onClick={() => void runPush()}
          >
            {pushing ? 'Writing to contacts…' : `Push to all ${push.campaigns} campaigns`}
          </Button>
          {pushMsg && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
              {pushMsg}
            </Typography>
          )}
        </Paper>
      )}

      {!push?.pending && pushMsg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setPushMsg(null)}>{pushMsg}</Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg}</Alert>}
      {loading && <Box sx={{ textAlign: 'center', py: 5 }}><CircularProgress /></Box>}

      {!loading && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {!vars.length && !adding && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Nothing set yet. The copy currently asks for <code>{'{{agency_website}}'}</code> and
              <code> {'{{office_address}}'}</code>, and both arrive blank until they are added here.
            </Typography>
          )}

          <Stack spacing={2}>
            {vars.map((v, i) => {
              const dirty = draft[v.name] !== undefined && draft[v.name] !== v.value;
              return (
                <Box key={v.name}>
                  {i > 0 && <Divider sx={{ mb: 2 }} />}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                    <Box sx={{ minWidth: 190 }}>
                      <Typography sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                        {`{{${v.name}}}`}
                      </Typography>
                      {v.description && (
                        <Typography variant="caption" sx={{ color: '#5a6675', display: 'block' }}>
                          {v.description}
                        </Typography>
                      )}
                      {v.updatedBy && (
                        <Typography variant="caption" sx={{ color: '#8a8f98', display: 'block' }}>
                          {v.updatedBy}{v.updatedAt ? ` · ${v.updatedAt}` : ''}
                        </Typography>
                      )}
                    </Box>
                    {/*
                      A typed value that was never saved is indistinguishable from a saved
                      one, and that cost a real test send: the field read as the new address
                      while every email carried the old one, and the only way to tell was to
                      look at who last wrote the row.

                      So an unsaved row says so, in red, on the field itself — and Enter saves,
                      because the hand that just typed a value expects Enter to commit it.
                    */}
                    <TextField
                      size="small" fullWidth
                      value={draft[v.name] ?? v.value}
                      onChange={(e) => setDraft((d) => ({ ...d, [v.name]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && dirty && !busy) {
                          void save(v.name, draft[v.name] ?? v.value, v.description);
                        }
                      }}
                      placeholder="(empty — it will arrive blank in every email)"
                      error={dirty}
                      helperText={dirty ? 'Not saved yet — press Save, or Enter.' : ' '}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    <Button
                      size="small" variant={dirty ? 'contained' : 'outlined'}
                      color={dirty ? 'error' : 'primary'}
                      disabled={!dirty || busy}
                      onClick={() => void save(v.name, draft[v.name] ?? v.value, v.description)}
                    >
                      {dirty ? 'Save' : 'Saved'}
                    </Button>
                    <Tooltip title="Remove this variable">
                      <span>
                        <IconButton size="small" disabled={busy} onClick={() => void remove(v.name)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Box>
              );
            })}
          </Stack>

          {adding ? (
            <Box sx={{ mt: 3, p: 2, border: '1px solid #e3e7ee', borderRadius: 1, bgcolor: '#fafbfc' }}>
              <Stack spacing={1.5}>
                <TextField
                  size="small" label="Name" autoFocus
                  value={newVar.name}
                  onChange={(e) => setNewVar((n) => ({ ...n, name: e.target.value }))}
                  helperText="Letters, numbers and underscores. The copy will use it as {{name}}."
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  size="small" label="Value"
                  value={newVar.value}
                  onChange={(e) => setNewVar((n) => ({ ...n, value: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  size="small" label="What it is for (optional)"
                  value={newVar.description}
                  onChange={(e) => setNewVar((n) => ({ ...n, description: e.target.value }))}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small" variant="contained" disabled={busy || !newVar.name.trim()}
                    onClick={() => void save(newVar.name.trim(), newVar.value, newVar.description || null)}
                  >
                    Add it
                  </Button>
                  <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
                </Stack>
              </Stack>
            </Box>
          ) : (
            <Button sx={{ mt: 2 }} size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
              Add a variable
            </Button>
          )}
        </Paper>
      )}
    </Container>
  );
}
