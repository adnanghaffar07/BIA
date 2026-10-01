'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack,
  TextField, Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * The three calls to action, edited here instead of in the code.
 *
 * ── Why a fixed three ───────────────────────────────────────────────────────
 * A CTA belongs to an email — the first ask, the follow-up, the last — so this is not the
 * free-form list the Email variables screen is. Three rows, always, each tied to its step.
 * A fourth would describe an email that does not exist.
 *
 * ── Why the preview is not decoration ───────────────────────────────────────
 * The wording may carry merge tokens, and a token nothing fills prints as literal braces to
 * a homeowner: "Grab 15 minutes here: {{ agency_website }}/meet" reached 92 of 186 C1–C3
 * contacts that way. So an unknown token is refused at the point of typing, and a token
 * that is known but empty is called out before it is saved rather than found in an inbox.
 */

type Cta = {
  step: 1 | 2 | 3;
  label: string;
  wording: string;
  updatedAt: string | null;
  updatedBy: string | null;
  unknownTokens: string[];
  needsWebsite: boolean;
};
type Problem = { field: string; message: string };

const STEP_WHEN: Record<number, string> = {
  1: 'Sent in email 1 — the first approach.',
  2: 'Sent in email 2 — 3 days later for C2–C3, 7 days for C4–C7.',
  3: 'Sent in email 3.',
};

/**
 * Which cohorts actually send this ask, as a chip rather than a sentence.
 *
 * stepsFor() gives C1–C3 two emails and C4–C7 three, so cta_3 renders empty on a C1 export
 * — correctly, since there is no third email to put it in. That was already written in the
 * grey line beside the step, and it was still read as the ask having failed to save: the
 * export shows a blank cell, and a blank cell looks like a bug wherever the explanation is
 * parked. So the exception gets the weight, next to the field it applies to.
 */
const USED_BY: Record<number, { label: string; exception: boolean }> = {
  1: { label: 'All cohorts', exception: false },
  2: { label: 'All cohorts', exception: false },
  3: { label: 'C4–C7 only', exception: true },
};

export default function CtasPage() {
  const [ctas, setCtas] = useState<Cta[]>([]);
  const [draft, setDraft] = useState<Record<number, { label: string; wording: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<number, Problem[]>>({});
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/ctas')).json();
      if (!j.success) throw new Error(j.error || 'Could not read the asks');
      setCtas(j.ctas);
      setDraft(Object.fromEntries(j.ctas.map((c: Cta) => [c.step, { label: c.label, wording: c.wording }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the asks');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (step: number) => {
    setSaving(step); setError(null);
    setProblems((p) => ({ ...p, [step]: [] }));
    try {
      const res = await fetch('/api/admin/ctas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, ...draft[step] }),
      });
      const j = await res.json();
      if (!j.success) {
        if (j.problems) { setProblems((p) => ({ ...p, [step]: j.problems })); return; }
        throw new Error(j.error || 'Could not save');
      }
      setCtas(j.ctas);
      setSaved(step);
      setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(null); }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Calls to action</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        The ask at the end of each email. One wording per email, used for every lead, so the
        copy says the same thing everywhere. Changing it here changes what goes out — no
        deploy, and no editing on the sending platform.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      <Stack spacing={2}>
        {ctas.map((c) => {
          const d = draft[c.step] ?? { label: c.label, wording: c.wording };
          const dirty = d.label !== c.label || d.wording !== c.wording;
          const probs = problems[c.step] ?? [];
          return (
            <Paper key={c.step} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                <Chip size="small" label={`{{cta_${c.step}}}`}
                  sx={{ height: 22, fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }} />
                <Chip
                  size="small"
                  label={USED_BY[c.step].label}
                  sx={{
                    height: 22, fontSize: 11, fontWeight: 700,
                    bgcolor: USED_BY[c.step].exception ? '#fff4e0' : '#eef2f7',
                    color: USED_BY[c.step].exception ? '#8a5a00' : '#5a6675',
                  }}
                />
                <Typography variant="body2" sx={{ color: '#5a6675' }}>{STEP_WHEN[c.step]}</Typography>
                {saved === c.step && <Chip size="small" label="saved" sx={{ height: 20, fontSize: 11, bgcolor: '#e7f5ec', color: '#166534' }} />}
              </Stack>

              <TextField
                label="Name for this ask" size="small" fullWidth sx={{ mb: 1.5, mt: 1 }}
                value={d.label}
                onChange={(e) => setDraft((p) => ({ ...p, [c.step]: { ...d, label: e.target.value } }))}
              />
              <TextField
                label="What the homeowner reads" size="small" fullWidth multiline minRows={2}
                value={d.wording}
                onChange={(e) => setDraft((p) => ({ ...p, [c.step]: { ...d, wording: e.target.value } }))}
                helperText={`${d.wording.length}/300 characters`}
              />

              {!!probs.length && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {probs.map((p, i) => <Box key={i}>{p.message}</Box>)}
                </Alert>
              )}

              {/*
                The website gap, said once per affected ask rather than as a global banner.
                Step 3's wording needs it on both of the old arms, which is why that ask has
                been arriving empty — worth seeing next to the field it affects.
              */}
              {/*
                Said where the blank will be noticed. The C1–C3 export shows an empty
                cta_3 column, and without this the reasonable reading is that the ask did
                not save.
              */}
              {USED_BY[c.step].exception && (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  C1, C2 and C3 run <strong>two</strong> emails, so this ask is not used
                  there — their export shows an empty <code>cta_3</code> column, and that is
                  correct rather than a failed save. C4 onward run three.
                </Alert>
              )}

              {c.needsWebsite && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  This ask contains <code>{'{{ agency_website }}'}</code>. Until the agency
                  website is set on Email variables, this ask is left EMPTY rather than sent
                  with a broken link — so the email goes out with no closing ask.
                </Alert>
              )}

              <Divider sx={{ my: 1.5 }} />
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
                <Button
                  size="small" variant="contained" disabled={!dirty || saving === c.step}
                  onClick={() => void save(c.step)}
                >
                  {saving === c.step ? 'Saving…' : 'Save'}
                </Button>
                {dirty && (
                  <Button size="small" onClick={() => setDraft((p) => ({ ...p, [c.step]: { label: c.label, wording: c.wording } }))}>
                    Undo
                  </Button>
                )}
                <Typography variant="caption" sx={{ ml: 'auto', color: '#8a8f98' }}>
                  {c.updatedAt
                    ? `Last changed ${c.updatedAt.slice(0, 10)}${c.updatedBy ? ` by ${c.updatedBy}` : ''}`
                    : 'Never changed'}
                </Typography>
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      {!loading && (
        <Alert severity="info" sx={{ mt: 3 }}>
          These reach a homeowner only once the contacts are updated. After changing an ask,
          use <strong>Update the contacts with today&apos;s values</strong> on the campaign —
          the sending platform stores each contact&apos;s variables at upload and never
          re-reads them on its own.
        </Alert>
      )}
    </Container>
  );
}
