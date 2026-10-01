'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack,
  TextField, MenuItem, Select, ToggleButton, ToggleButtonGroup, IconButton, Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';

/**
 * The subject lines — the words AND where each one goes.
 *
 * ── Why the routing is editable too ─────────────────────────────────────────
 * Abdullah, 2 Oct 2026: "do not hardcode anything, let Zoya think which subject goes to
 * which email and which variant."
 *
 * The first version made the TEXT editable and left the mapping in the seed, so "try this
 * line on C4 instead" was still a developer job — the thing we were removing. Every row now
 * carries its own audience: segment, email, variant, cohorts.
 *
 * ── Which makes two new ways to get it wrong, so both are checked ───────────
 * Two lines claiming one audience means the lookup takes the first and the other silently
 * never sends. An audience with no line falls back to the old built-in wording, so the
 * screen appears to have no effect on it. The first is refused at save; the second is
 * reported in red at the top and recomputed after every change.
 */

type Subject = {
  id: string; segment: 'rated' | 'unrated' | 'grade_b'; step: number;
  variant: 'A' | 'B'; cohorts: string[]; name: string; template: string;
  updatedAt: string | null; updatedBy: string | null; unknownTokens: string[];
};
type Problem = { field: string; message: string };
type Coverage = { checked: number; missing: Array<{ segment: string; cohort: string; step: number; variant: string }> };

const COHORTS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
const SEGMENTS: Array<{ value: Subject['segment']; label: string }> = [
  { value: 'rated', label: 'Rated' },
  { value: 'unrated', label: 'Not rated' },
  { value: 'grade_b', label: 'Grade B' },
];
const SEGMENT_BLURB: Record<string, string> = {
  rated: 'A carrier has priced these, so the copy can lead with a number.',
  unrated: 'No carrier premium — there is no number to quote, and the copy must not imply one.',
  grade_b: 'The roof approach. A different offer, not a variant of the others.',
};

const BLANK = {
  segment: 'rated' as const, step: 1, variant: 'A' as const,
  cohorts: [] as string[], name: '', template: '',
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<Subject>>>({});
  const [adding, setAdding] = useState<typeof BLANK | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<Record<string, Problem[]>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/subjects')).json();
      if (!j.success) throw new Error(j.error || 'Could not read the subjects');
      setSubjects(j.subjects); setCoverage(j.coverage); setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the subjects');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const field = (s: Subject, k: keyof Subject) => (draft[s.id]?.[k] ?? s[k]) as never;
  const edit = (id: string, patch: Partial<Subject>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const save = async (s: Subject) => {
    setBusy(s.id); setError(null); setProblems((p) => ({ ...p, [s.id]: [] }));
    try {
      const d = draft[s.id] ?? {};
      const res = await fetch('/api/admin/subjects', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: s.id,
          name: d.name ?? s.name,
          template: d.template ?? s.template,
          routing: {
            segment: d.segment ?? s.segment, step: d.step ?? s.step,
            variant: d.variant ?? s.variant, cohorts: d.cohorts ?? s.cohorts,
          },
        }),
      });
      const j = await res.json();
      if (!j.success) {
        if (j.problems) { setProblems((p) => ({ ...p, [s.id]: j.problems })); return; }
        throw new Error(j.error || 'Could not save');
      }
      setSubjects(j.subjects); setCoverage(j.coverage);
      setDraft((d) => { const n = { ...d }; delete n[s.id]; return n; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setBusy(null); }
  };

  const create = async () => {
    if (!adding) return;
    setBusy('new'); setError(null); setProblems((p) => ({ ...p, new: [] }));
    try {
      const res = await fetch('/api/admin/subjects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing: { segment: adding.segment, step: adding.step, variant: adding.variant, cohorts: adding.cohorts },
          name: adding.name, template: adding.template,
        }),
      });
      const j = await res.json();
      if (!j.success) {
        if (j.problems) { setProblems((p) => ({ ...p, new: j.problems })); return; }
        throw new Error(j.error || 'Could not create');
      }
      setSubjects(j.subjects); setCoverage(j.coverage); setAdding(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create');
    } finally { setBusy(null); }
  };

  const remove = async (s: Subject) => {
    setBusy(s.id); setError(null); setNotice(null);
    try {
      const j = await (await fetch(`/api/admin/subjects?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })).json();
      if (!j.success) throw new Error(j.error || 'Could not delete');
      setSubjects(j.subjects); setCoverage(j.coverage);
      if (j.stranded?.length) {
        setNotice(`Removed. ${j.stranded.length} audience(s) now have no line of their own and `
          + `fall back to the old built-in wording: ${j.stranded.slice(0, 3).join(' · ')}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally { setBusy(null); }
  };

  const routingRow = (
    v: { segment: string; step: number; variant: string; cohorts: string[] },
    on: (patch: Record<string, unknown>) => void,
  ) => (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      <Select size="small" value={v.segment} sx={{ minWidth: 120 }}
        onChange={(e) => on({ segment: e.target.value })}>
        {SEGMENTS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
      </Select>
      <Select size="small" value={v.step} sx={{ minWidth: 104 }}
        onChange={(e) => on({ step: Number(e.target.value) })}>
        {[1, 2, 3].map((n) => <MenuItem key={n} value={n}>Email {n}</MenuItem>)}
      </Select>
      {/*
        The variable this line fills, spelled the way the sequence must reference it.
        "Email 1" tells you where it goes; it does not tell you what to type into the
        platform's subject box, and those are the two halves of the same question. It is
        derived from the step rather than stored, so changing the email above changes this
        in the same breath — a label that could disagree with its own row would be worse
        than no label.
      */}
      <Chip
        size="small"
        label={`{{subject_${v.step}}}`}
        sx={{ height: 24, fontSize: 12, fontFamily: 'monospace', fontWeight: 700, bgcolor: '#eef2f7' }}
      />
      <ToggleButtonGroup size="small" exclusive value={v.variant}
        onChange={(_, val) => val && on({ variant: val })}>
        <ToggleButton value="A" sx={{ px: 1.5 }}>A</ToggleButton>
        <ToggleButton value="B" sx={{ px: 1.5 }}>B</ToggleButton>
      </ToggleButtonGroup>
      {/*
        Cohorts as toggles rather than a multi-select: the question "does C4 use this line"
        is answered by looking, and none-selected meaning ALL is spelled out below rather
        than left as a convention somebody has to know.
      */}
      <ToggleButtonGroup size="small" value={v.cohorts}
        onChange={(_, val: string[]) => on({ cohorts: val })}>
        {COHORTS.map((c) => <ToggleButton key={c} value={c} sx={{ px: 1 }}>{c}</ToggleButton>)}
      </ToggleButtonGroup>
      <Typography variant="caption" sx={{ color: '#8a8f98' }}>
        {v.cohorts.length ? `${v.cohorts.length} cohort(s)` : 'none picked = every cohort'}
      </Typography>
    </Stack>
  );

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Subject lines</Typography>
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => setAdding({ ...BLANK })} disabled={!!adding}>
            Add a line
          </Button>
          <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
            <RefreshIcon fontSize="small" />
          </Button>
        </Stack>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        What appears in the inbox, and who gets it. Each line carries its own audience — the
        segment, which email in the sequence, which A/B variant and which cohorts — so the
        routing is yours to change, not something fixed in the code.
      </Typography>
      {/*
        The one instruction somebody needs to act on this screen, said once at the top.
        Without it the page explains what a line IS and never what to do with it, and the
        answer lives on a different screen in a different tool.
      */}
      <Alert severity="info" sx={{ mb: 2 }}>
        In the sending platform, the subject box for <strong>email 1</strong> should contain
        exactly <code>{'{{subject_1}}'}</code>, email 2 <code>{'{{subject_2}}'}</code>, and
        email 3 <code>{'{{subject_3}}'}</code> — never a typed sentence. Each line below shows
        the variable it fills. Which of several lines a given person receives is decided by
        the segment, variant and cohorts on that row.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {coverage && (
        coverage.missing.length > 0 ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>{coverage.missing.length} of {coverage.checked} audiences have no line of their
            own</strong> and fall back to the old built-in wording — changes here will not reach
            them. Missing:{' '}
            {[...new Set(coverage.missing.map((m) => `${m.segment} · email ${m.step} · ${m.variant}`))]
              .slice(0, 6).join('  |  ')}
          </Alert>
        ) : (
          <Alert severity="success" sx={{ mb: 2 }}>
            All {coverage.checked} audiences have a line of their own.
          </Alert>
        )
      )}

      {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {adding && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderColor: '#9ec5fe' }}>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>New subject line</Typography>
          {routingRow(adding, (patch) => setAdding((a) => ({ ...a!, ...patch })))}
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <TextField label="Short name" size="small" sx={{ width: 190 }} value={adding.name}
              onChange={(e) => setAdding((a) => ({ ...a!, name: e.target.value }))} />
            <TextField label="Subject line" size="small" sx={{ flex: 1, minWidth: 320 }} value={adding.template}
              onChange={(e) => setAdding((a) => ({ ...a!, template: e.target.value }))}
              helperText={`${adding.template.length} characters — most phones cut around 60`} />
            <Box>
              <Button size="small" variant="contained" sx={{ mt: 0.5 }} disabled={busy === 'new'}
                onClick={() => void create()}>{busy === 'new' ? '…' : 'Create'}</Button>
              <Button size="small" sx={{ mt: 0.5 }} onClick={() => setAdding(null)}>Cancel</Button>
            </Box>
          </Stack>
          {!!(problems.new ?? []).length && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {problems.new.map((p, i) => <Box key={i}>{p.message}</Box>)}
            </Alert>
          )}
        </Paper>
      )}

      {SEGMENTS.map((seg) => {
        const mine = subjects.filter((s) => s.segment === seg.value);
        if (!mine.length) return null;
        return (
          <Box key={seg.value} sx={{ mb: 4 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{seg.label}</Typography>
            <Typography variant="body2" sx={{ color: '#5a6675', mb: 1.5 }}>{SEGMENT_BLURB[seg.value]}</Typography>
            <Stack spacing={1}>
              {mine.sort((a, b) => a.step - b.step || a.variant.localeCompare(b.variant)).map((s) => {
                const d = draft[s.id] ?? {};
                const dirty = Object.keys(d).length > 0;
                const probs = problems[s.id] ?? [];
                return (
                  <Paper key={s.id} variant="outlined" sx={{ p: 1.5, borderColor: dirty ? '#9ec5fe' : undefined }}>
                    {routingRow(
                      {
                        segment: field(s, 'segment'), step: field(s, 'step'),
                        variant: field(s, 'variant'), cohorts: field(s, 'cohorts'),
                      },
                      (patch) => edit(s.id, patch as Partial<Subject>),
                    )}
                    <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                      <TextField label="Short name" size="small" sx={{ width: 190 }}
                        value={field(s, 'name')} onChange={(e) => edit(s.id, { name: e.target.value })} />
                      <TextField label="Subject line" size="small" sx={{ flex: 1, minWidth: 300 }}
                        value={field(s, 'template')} onChange={(e) => edit(s.id, { template: e.target.value })}
                        helperText={`${String(field(s, 'template')).length} characters`} />
                      <Box>
                        <Button size="small" variant="contained" sx={{ mt: 0.5 }}
                          disabled={!dirty || busy === s.id} onClick={() => void save(s)}>
                          {busy === s.id ? '…' : 'Save'}
                        </Button>
                      </Box>
                      <IconButton size="small" sx={{ mt: 0.5 }} disabled={busy === s.id}
                        onClick={() => void remove(s)} aria-label="Remove this line">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    {!!probs.length && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {probs.map((p, i) => <Box key={i}>{p.message}</Box>)}
                      </Alert>
                    )}
                    <Typography variant="caption" sx={{ color: '#8a8f98' }}>
                      {s.updatedAt ? `${s.updatedAt.slice(0, 10)}${s.updatedBy ? ` · ${s.updatedBy}` : ''}` : ''}
                    </Typography>
                  </Paper>
                );
              })}
            </Stack>
            <Divider sx={{ mt: 2 }} />
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
