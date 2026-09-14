'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, TextField, Stack, Alert, Typography, Paper, IconButton,
  CircularProgress, Divider, Tooltip, Box,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';

/**
 * The email sequence — subject and body per step, with a delay between them.
 *
 * Step 1 always sends immediately, so its delay is fixed at zero and not shown as a
 * control; later steps carry the days to wait after the previous one. Modelling it
 * any other way invites someone to set a delay on the first email and wonder why
 * nothing went out.
 *
 * Rendered inline as a tab panel — unsaved edits are reported through onDirtyChange
 * so the page can guard the tab switch rather than dropping a half-written email.
 */

export type SequenceStep = { delay: number; subject: string; body: string };

const MERGE_FIELDS = ['{{firstName}}', '{{lastName}}', '{{property_address}}', '{{renewal_date}}'];

export default function CampaignSequencePanel({
  campaignId, current, onSaved, onDirtyChange,
}: {
  campaignId: string;
  current: SequenceStep[];
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initial: SequenceStep[] = current.length ? current : [{ delay: 0, subject: '', body: '' }];
  const [steps, setSteps] = useState<SequenceStep[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<SequenceStep>) =>
    setSteps((prev) => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const addStep = () => setSteps((prev) => [...prev, { delay: 3, subject: '', body: '' }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, n) => n !== i));

  // An empty subject or body would send a blank email, so saving is blocked on it
  // rather than discovered by a recipient.
  const incomplete = steps.some((s) => !s.subject.trim() || !s.body.trim());
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence: steps }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save the sequence');
      onDirtyChange?.(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the sequence');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Merge fields are filled per lead: {MERGE_FIELDS.join(', ')}
      </Typography>

      <Stack spacing={2} sx={{ maxWidth: 860 }}>
        {steps.map((s, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {i === 0 ? 'Email 1 — sends immediately' : `Email ${i + 1}`}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {i > 0 && (
                  <TextField
                    label="Days after previous" type="number" size="small"
                    value={s.delay}
                    onChange={(e) => update(i, { delay: Math.max(1, Number(e.target.value) || 1) })}
                    sx={{ width: 170 }}
                  />
                )}
                {steps.length > 1 && (
                  <Tooltip title="Remove this email">
                    <IconButton size="small" onClick={() => removeStep(i)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Stack>

            <Stack spacing={1.5}>
              <TextField
                label="Subject" size="small" fullWidth value={s.subject}
                onChange={(e) => update(i, { subject: e.target.value })}
                error={!s.subject.trim()}
                placeholder="Your home insurance renews soon"
              />
              <TextField
                label="Body" size="small" fullWidth multiline minRows={6} value={s.body}
                onChange={(e) => update(i, { body: e.target.value })}
                error={!s.body.trim()}
                placeholder={'Hi {{firstName}},\n\nYour policy on {{property_address}} renews on {{renewal_date}}…'}
              />
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Divider sx={{ my: 2, maxWidth: 860 }} />

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={addStep}>
          Add follow-up email
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {dirty && !saving && <Typography variant="caption" color="warning.main">Unsaved changes</Typography>}
        <Button
          variant="contained" onClick={save} disabled={saving || incomplete || !dirty}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : `Save ${steps.length} email${steps.length === 1 ? '' : 's'}`}
        </Button>
      </Stack>

      {incomplete && (
        <Alert severity="info" sx={{ mt: 2, maxWidth: 860 }}>
          Every email needs a subject and a body before this can be saved.
        </Alert>
      )}
    </Box>
  );
}
