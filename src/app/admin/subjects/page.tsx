'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack,
  TextField, Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * The subject lines, edited here instead of in the code.
 *
 * ── Why this is 25 rows and the CTAs were 3 ─────────────────────────────────
 * A CTA reads the same to anybody. A subject does not: a RATED account is offered a number
 * and an UNRATED one cannot be, a lead renewing next week should not read the same line as
 * one six weeks out, and Grade B is a different offer entirely. Collapsing these would send
 * priced copy to accounts with no price.
 *
 * ── Grouped the way somebody edits ──────────────────────────────────────────
 * By audience first, then email, then A/B — because a person coming here is changing "what
 * we say to unrated C1–C3 accounts", not "row 14". A flat list of 25 would make the one
 * line they want a search rather than a glance.
 */

type Subject = {
  id: string; segment: 'rated' | 'unrated' | 'grade_b'; step: number;
  variant: 'A' | 'B'; cohorts: string[]; name: string; template: string;
  updatedAt: string | null; updatedBy: string | null; unknownTokens: string[];
};
type Problem = { field: string; message: string };

const SEGMENT_LABEL: Record<string, { title: string; blurb: string }> = {
  rated: {
    title: 'Rated accounts',
    blurb: 'A carrier has priced these, so the copy can lead with a number.',
  },
  unrated: {
    title: 'Not rated',
    blurb: 'No carrier premium, so there is no number to quote — the copy must not imply one.',
  },
  grade_b: {
    title: 'Grade B',
    blurb: 'The roof approach. One pair, used at every email.',
  },
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [coverage, setCoverage] = useState<{ checked: number; missing: unknown[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, { name: string; template: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, Problem[]>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/subjects')).json();
      if (!j.success) throw new Error(j.error || 'Could not read the subjects');
      setSubjects(j.subjects); setCoverage(j.coverage);
      setDraft(Object.fromEntries(j.subjects.map((s: Subject) => [s.id, { name: s.name, template: s.template }])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the subjects');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (id: string) => {
    setSaving(id); setError(null);
    setProblems((p) => ({ ...p, [id]: [] }));
    try {
      const res = await fetch('/api/admin/subjects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...draft[id] }),
      });
      const j = await res.json();
      if (!j.success) {
        if (j.problems) { setProblems((p) => ({ ...p, [id]: j.problems })); return; }
        throw new Error(j.error || 'Could not save');
      }
      setSubjects(j.subjects);
      setSaved(id); setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setSaving(null); }
  };

  const grouped = useMemo(() => {
    const out: Record<string, Record<number, Subject[]>> = {};
    for (const s of subjects) {
      ((out[s.segment] ??= {})[s.step] ??= []).push(s);
    }
    return out;
  }, [subjects]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Subject lines</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        What appears in the inbox. These vary by who is being written to and when — a priced
        account, an unpriced one, a lead renewing next week against one six weeks out — so
        there are more of them than there are asks. Changing one here changes what goes out.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {coverage && coverage.missing.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {coverage.missing.length} of {coverage.checked} audiences have no stored line and
          are falling back to the old built-in wording — editing here will not change what
          they receive.
        </Alert>
      )}
      {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {(['rated', 'unrated', 'grade_b'] as const).map((seg) => {
        const steps = grouped[seg];
        if (!steps) return null;
        return (
          <Box key={seg} sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, mt: 2 }}>{SEGMENT_LABEL[seg].title}</Typography>
            <Typography variant="body2" sx={{ color: '#5a6675', mb: 1.5 }}>{SEGMENT_LABEL[seg].blurb}</Typography>
            {Object.keys(steps).map(Number).sort().map((step) => (
              <Box key={step} sx={{ mb: 2 }}>
                <Typography variant="overline" sx={{ color: '#8a8f98' }}>
                  {seg === 'grade_b' ? 'Every email' : `Email ${step}`}
                </Typography>
                <Stack spacing={1}>
                  {steps[step].map((s) => {
                    const d = draft[s.id] ?? { name: s.name, template: s.template };
                    const dirty = d.name !== s.name || d.template !== s.template;
                    const probs = problems[s.id] ?? [];
                    const long = d.template.length > 60;
                    return (
                      <Paper key={s.id} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
                          <Chip size="small" label={`Variant ${s.variant}`}
                            sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
                          <Chip size="small" variant="outlined"
                            label={s.cohorts.length ? s.cohorts.join(', ') : 'All cohorts'}
                            sx={{ height: 20, fontSize: 11 }} />
                          {saved === s.id && <Chip size="small" label="saved"
                            sx={{ height: 20, fontSize: 11, bgcolor: '#e7f5ec', color: '#166534' }} />}
                          <Typography variant="caption" sx={{ ml: 'auto', color: '#8a8f98' }}>
                            {s.updatedAt ? `${s.updatedAt.slice(0, 10)}${s.updatedBy ? ` · ${s.updatedBy}` : ''}` : ''}
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                          <TextField
                            label="Short name" size="small" sx={{ width: 190 }} value={d.name}
                            onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...d, name: e.target.value } }))}
                          />
                          <TextField
                            label="Subject line" size="small" sx={{ flex: 1, minWidth: 320 }} value={d.template}
                            onChange={(e) => setDraft((p) => ({ ...p, [s.id]: { ...d, template: e.target.value } }))}
                            helperText={
                              /*
                                60 characters is roughly where a phone truncates. Said as a
                                count rather than enforced — a long subject is a judgement,
                                and a broken token is not.
                              */
                              long
                                ? `${d.template.length} characters — most phones cut around 60`
                                : `${d.template.length} characters`
                            }
                          />
                          <Box>
                            <Button size="small" variant="contained" disabled={!dirty || saving === s.id}
                              onClick={() => void save(s.id)} sx={{ mt: 0.5 }}>
                              {saving === s.id ? '…' : 'Save'}
                            </Button>
                          </Box>
                        </Stack>
                        {!!probs.length && (
                          <Alert severity="error" sx={{ mt: 1 }}>
                            {probs.map((p, i) => <Box key={i}>{p.message}</Box>)}
                          </Alert>
                        )}
                      </Paper>
                    );
                  })}
                </Stack>
              </Box>
            ))}
            <Divider />
          </Box>
        );
      })}

      {!loading && (
        <Alert severity="info">
          These reach a homeowner only once the contacts are updated. After changing a line,
          use <strong>Update the contacts with today&apos;s values</strong> on the campaign.
        </Alert>
      )}
    </Container>
  );
}
