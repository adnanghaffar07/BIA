'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Box,
  TextField, Alert, CircularProgress, IconButton, Paper, Tooltip,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';

/**
 * Pick a saved template to drop into a sequence step, or save the current step as one.
 *
 * Applying a template COPIES its text into the step. The campaign then owns that copy,
 * so editing the template later cannot silently rewrite a campaign that is already
 * sending — which is the behaviour anyone would assume from the word "template", and
 * the opposite of what a live reference would do.
 */

export type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdBy: string | null;
  updatedAt: string;
};

export function useTemplates(open: boolean) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    fetch('/api/lead-campaigns/templates')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Could not load templates');
        return j.templates as Template[];
      })
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load templates'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/lead-campaigns/templates')
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Could not load templates');
        return j.templates as Template[];
      })
      .then((t) => { if (!cancelled) { setTemplates(t); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load templates'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  return { templates, loading, error, reload, setError };
}

export function TemplateLoadDialog({
  open, onClose, onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (t: Template) => void;
}) {
  const { templates, loading, error, reload, setError } = useTemplates(open);
  const [removing, setRemoving] = useState<string | null>(null);

  const remove = async (t: Template) => {
    setRemoving(t.id);
    try {
      const res = await fetch(`/api/lead-campaigns/templates/${t.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not delete');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Use a template</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><CircularProgress size={18} /><Typography variant="body2" color="text.secondary">Loading…</Typography></Stack>}

        {!loading && !templates.length && (
          <Typography variant="body2" color="text.secondary">
            No templates saved yet. Write an email, then use “Save as template”.
          </Typography>
        )}

        <Stack spacing={1.5}>
          {templates.map((t) => (
            <Paper key={t.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t.name}</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25 }} noWrap>{t.subject}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.body.replace(/\s+/g, ' ').slice(0, 90)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <Button size="small" variant="outlined" onClick={() => { onApply(t); onClose(); }}>
                    Use
                  </Button>
                  <Tooltip title="Delete this template">
                    <span>
                      <IconButton size="small" disabled={removing === t.id} onClick={() => remove(t)}>
                        {removing === t.id
                          ? <CircularProgress size={14} />
                          : <DeleteOutlineIcon fontSize="small" sx={{ color: '#b3261e' }} />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function TemplateSaveDialog({
  open, onClose, subject, body, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  subject: string;
  body: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the name is taken — the second press is the deliberate overwrite. */
  const [conflict, setConflict] = useState(false);

  const save = async (overwrite: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/lead-campaigns/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), subject, body, overwrite }),
      });
      const json = await res.json();
      if (res.status === 409 && json.conflict) { setConflict(true); setError(json.error); return; }
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save the template');
      onSaved();
      onClose();
      setName('');
      setConflict(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the template');
    } finally {
      setSaving(false);
    }
  };

  const incomplete = !subject.trim() || !body.trim();

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save as template</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity={conflict ? 'warning' : 'error'}>{error}</Alert>}
          {incomplete && (
            <Alert severity="info">
              Write a subject and a body first — a template needs both.
            </Alert>
          )}
          <TextField
            label="Template name" size="small" fullWidth autoFocus value={name}
            onChange={(e) => { setName(e.target.value); setConflict(false); }}
            placeholder="e.g. Monmouth renewal — first touch"
          />
          <Typography variant="caption" color="text.secondary">
            Saves the subject and body of this email. Merge fields are kept as written.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>Cancel</Button>
        <Button
          variant="contained" onClick={() => save(conflict)}
          disabled={saving || !name.trim() || incomplete}
          color={conflict ? 'warning' : 'primary'}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : conflict ? 'Replace it' : 'Save template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
