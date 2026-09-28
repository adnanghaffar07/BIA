'use client';

import React, { useEffect, useState } from 'react';
import {
  Button, TextField, Stack, Alert, Typography, Paper, IconButton,
  CircularProgress, Divider, Tooltip, Box,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooksOutlined';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAddOutlined';
import MergeFieldPalette from '@/components/MergeFieldPalette';
import { MERGE_FIELDS, unknownTokensIn, blockedTokensIn } from '@/lib/mergeFields';
import { TemplateLoadDialog, TemplateSaveDialog } from '@/components/TemplatePicker';
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
  const [loadInto, setLoadInto] = useState<number | null>(null);
  const [saveFrom, setSaveFrom] = useState<number | null>(null);

  const update = (i: number, patch: Partial<SequenceStep>) =>
    setSteps((prev) => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  /**
   * Click-to-insert, at the caret of whichever field is being edited.
   *
   * Reads document.activeElement rather than tracking focus in state. The palette's
   * chips suppress mousedown, so focus never leaves the field and the caret is still
   * live when the click lands — which means the token goes exactly where the cursor
   * was, the same as a drop. Each field carries data-step / data-field so the element
   * maps back to the step it belongs to without a lookup table.
   *
   * With nothing focused it falls back to appending to the first email's body, which is
   * where someone who has not clicked anywhere yet would expect it to go.
   */
  const insertToken = (token: string) => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const step = Number(el?.dataset?.step);
    const field = el?.dataset?.field as 'subject' | 'body' | undefined;

    if (!el || !Number.isInteger(step) || (field !== 'subject' && field !== 'body')) {
      setSteps((prev) => prev.map((s, n) => (n === 0
        ? { ...s, body: s.body && !/\s$/.test(s.body) ? `${s.body} ${token}` : `${s.body}${token}` }
        : s)));
      return;
    }

    const at = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    setSteps((prev) => prev.map((s, n) => {
      if (n !== step) return s;
      const value = field === 'subject' ? s.subject : s.body;
      return { ...s, [field]: value.slice(0, at) + token + value.slice(at) };
    }));
  };

  /**
   * Drop a merge field into a subject or body at the caret.
   *
   * Handled explicitly rather than left to the browser's default text-drop. The default
   * does work on a real drag, but it is only performed for TRUSTED events, which makes
   * it impossible to test and leaves the feature resting on behaviour that cannot be
   * checked. Doing it here is deterministic and exercisable.
   *
   * `selectionStart` is the drop point: the browser moves the caret to follow the
   * pointer during dragover, so by the time drop fires it already sits where the token
   * should land.
   *
   * Only OUR tokens are intercepted. Text dragged in from anywhere else falls through
   * to the browser, so ordinary drag-and-drop of a sentence still behaves normally.
   */
  const handleDrop = (
    i: number,
    field: 'subject' | 'body',
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    const token = e.dataTransfer.getData('text/plain');
    if (!MERGE_FIELDS.some((f) => f.token === token)) return;

    e.preventDefault();
    const el = e.target as HTMLInputElement | HTMLTextAreaElement;
    const value = field === 'subject' ? steps[i].subject : steps[i].body;
    const at = typeof el?.selectionStart === 'number' ? el.selectionStart : value.length;
    update(i, { [field]: value.slice(0, at) + token + value.slice(at) });
  };

  const addStep = () => setSteps((prev) => [...prev, { delay: 3, subject: '', body: '' }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, n) => n !== i));

  // An empty subject or body would send a blank email, so saving is blocked on it
  // rather than discovered by a recipient.
  const incomplete = steps.some((s) => !s.subject.trim() || !s.body.trim());

  /**
   * ── A variable that does not exist is the quietest bug in the system ────────
   *
   * The platform does not validate merge variables. A template asking for one the contact
   * does not carry renders NOTHING — no error, no bounce, no failed send, no row in any log.
   * The email goes out with a hole in it and the first person to notice is the homeowner.
   *
   * It has already happened once: a send arrived reading "Hi ," while the contact was
   * holding "Abdullah" the whole time, because the copy said first_name and the built-in is
   * spelled firstName. Nothing anywhere reported it.
   *
   * So the name is checked HERE, at the only moment somebody is still looking at the copy.
   * Every unknown name in every step is listed at once rather than one per save — somebody
   * fixing a typo one save at a time is somebody who stops reading the message.
   */
  const unknown = [...new Set(steps.flatMap((s) => [
    ...unknownTokensIn(s.subject),
    ...unknownTokensIn(s.body),
  ]))];

  /**
   * Valid, but empty on every contact today — the booking link and the price band, both
   * waiting on Frank. A warning and not a block: the copy is correct and the value will
   * arrive, and refusing to save it would mean the sequence cannot be written until he
   * answers. But it is said out loud, because a variable that renders blank looks exactly
   * like a variable that works right up until the send.
   */
  const blocked = [...new Map(steps.flatMap((s) => [
    ...blockedTokensIn(s.subject),
    ...blockedTokensIn(s.body),
  ]).map((f) => [f.name, f])).values()];
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

      {/*
        The palette sits BESIDE the email being written, not above it.

        Above, it pushed the fields down the page, so the moment you scrolled to the body
        the chips were gone — which is when you actually need them. Reading a variable name
        off a list you can no longer see is how {{first_name}} gets typed from memory, and
        that renders as nothing at all.

        It wraps under the editor below ~1100px rather than shrinking into a column too
        narrow for a chip to stay on one line.
      */}
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={3}
        sx={{ alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: '1 1 auto', maxWidth: 860, minWidth: 0, width: '100%' }}>
        <Stack spacing={2}>
          {steps.map((s, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {i === 0 ? 'Email 1 — sends immediately' : `Email ${i + 1}`}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Button size="small" startIcon={<LibraryBooksIcon />} onClick={() => setLoadInto(i)}>
                    Use template
                  </Button>
                  <Button size="small" startIcon={<BookmarkAddIcon />} onClick={() => setSaveFrom(i)}>
                    Save as template
                  </Button>
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
                  slotProps={{ htmlInput: { 'data-step': i, 'data-field': 'subject' } }}
                  onDrop={(e) => handleDrop(i, 'subject', e)}
                  error={!s.subject.trim()}
                  placeholder="Your home insurance renews soon"
                />
                <TextField
                  label="Body" size="small" fullWidth multiline minRows={6} value={s.body}
                  onChange={(e) => update(i, { body: e.target.value })}
                  slotProps={{ htmlInput: { 'data-step': i, 'data-field': 'body' } }}
                  onDrop={(e) => handleDrop(i, 'body', e)}
                  error={!s.body.trim()}
                  placeholder={'Hi {{firstName}},\n\nYour policy on {{property_address}} renews on {{renewal_date}}…'}
                />
              </Stack>
            </Paper>
          ))}
        </Stack>

        <TemplateLoadDialog
          open={loadInto != null}
          onClose={() => setLoadInto(null)}
          onApply={(t) => {
            if (loadInto == null) return;
            // Copy, not a reference — editing the template later must not rewrite a
            // campaign that is already sending.
            update(loadInto, { subject: t.subject, body: t.body });
          }}
        />

        <TemplateSaveDialog
          open={saveFrom != null}
          onClose={() => setSaveFrom(null)}
          subject={saveFrom != null ? steps[saveFrom]?.subject ?? '' : ''}
          body={saveFrom != null ? steps[saveFrom]?.body ?? '' : ''}
          onSaved={() => setSaveFrom(null)}
        />

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={addStep}>
            Add follow-up email
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          {dirty && !saving && <Typography variant="caption" color="warning.main">Unsaved changes</Typography>}
          <Button
            variant="contained" onClick={save} disabled={saving || incomplete || unknown.length > 0 || !dirty}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {saving ? 'Saving…' : `Save ${steps.length} email${steps.length === 1 ? '' : 's'}`}
          </Button>
        </Stack>

        {unknown.length > 0 && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {unknown.length === 1 ? 'This variable does not exist: ' : 'These variables do not exist: '}
            <strong>{unknown.map((t) => `{{${t}}}`).join(', ')}</strong>.
            {' '}It would send as blank text with nothing to say it had gone wrong. Use a chip
            from the list beside this, or fix the spelling — the platform is case-sensitive, and
            {' '}<code>firstName</code> and <code>first_name</code> are not the same variable.
          </Alert>
        )}

        {blocked.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            These are real variables but they are <strong>empty on every contact today</strong>,
            so they would render as nothing:
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {blocked.map((f) => <li key={f.name}><code>{f.token}</code> — {f.blocked}</li>)}
            </ul>
          </Alert>
        )}

        {incomplete && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Every email needs a subject and a body before this can be saved.
          </Alert>
        )}
        </Box>

        {/*
          Sticky, so it stays level with whichever field is being edited. `top` clears the
          page header; `maxHeight`/`overflowY` keep the 25 chips scrollable inside their own
          column instead of running off the bottom of a short viewport.
        */}
        <Box
          sx={{
            flex: '0 0 auto',
            width: { xs: '100%', lg: 340 },
            position: { lg: 'sticky' },
            top: { lg: 88 },
            maxHeight: { lg: 'calc(100vh - 120px)' },
            overflowY: { lg: 'auto' },
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 2,
          }}
        >
          <MergeFieldPalette onInsert={(token) => insertToken(token)} />
        </Box>
      </Stack>
    </Box>
  );
}
