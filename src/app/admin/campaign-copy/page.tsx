'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, CircularProgress, Alert, Stack, Divider,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * Repair the copy held on the sending platform.
 *
 * ── Why a preview and a button per campaign ─────────────────────────────────
 * Applying replaces a live campaign's ENTIRE email sequence — the vendor has no endpoint for
 * one field — so a single button that did all nine would make the same mistake nine times
 * before anybody could look at the first. Every change is shown as before → after, and each
 * campaign is applied on its own.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 * It renames tokens that fill with nothing and points the subject at the Subject lines
 * screen. It does not touch prose. Zoya writes the copy; a tool that quietly reworded an
 * approved sentence would never be trusted with the ones it does fix.
 */

type Change = { step: number; variant: number; field: 'subject' | 'body'; from: string; to: string; why: string };
type Plan = {
  campaignId: string; campaignName: string; changes: Change[];
  unresolved: Array<{ token: string; where: string }>;
};

export default function CampaignCopyPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, { applied: number; verified: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch('/api/admin/campaign-copy-push')).json();
      if (!j.success) throw new Error(j.error || 'Could not read the copy');
      setPlans(j.plans);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the copy');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const apply = async (campaignId: string) => {
    setApplying(campaignId); setError(null);
    try {
      const res = await fetch('/api/admin/campaign-copy-push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Could not apply');
      setDone((d) => ({ ...d, [campaignId]: { applied: j.applied, verified: j.verified } }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply');
    } finally { setApplying(null); }
  };

  const withChanges = plans.filter((p) => p.changes.length);
  const totalChanges = withChanges.reduce((n, p) => n + p.changes.length, 0);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Campaign copy</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
          <RefreshIcon fontSize="small" />
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        The subject and body were typed into the sending platform by hand, so every sentence
        exists twice and the copies have drifted. This points each subject at the Subject
        lines screen and renames variables that fill with nothing. It does not change any
        wording somebody wrote.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {!loading && !withChanges.length && (
        <Alert severity="success">Every campaign&apos;s copy already matches the CRM.</Alert>
      )}

      {!loading && !!withChanges.length && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <strong>{totalChanges} change{totalChanges === 1 ? '' : 's'} across {withChanges.length} campaign
          {withChanges.length === 1 ? '' : 's'}.</strong> Applying replaces that campaign&apos;s
          whole email sequence on the platform, so review the before and after first.
        </Alert>
      )}

      <Stack spacing={2}>
        {withChanges.map((p) => {
          const d = done[p.campaignId];
          return (
            <Paper key={p.campaignId} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography sx={{ fontWeight: 700 }}>{p.campaignName}</Typography>
                <Chip size="small" label={`${p.changes.length} change${p.changes.length === 1 ? '' : 's'}`}
                  sx={{ height: 20, fontSize: 11, bgcolor: '#fff4e0', color: '#8a5a00' }} />
                {d && (
                  <Chip size="small"
                    label={d.verified ? `applied ${d.applied}, verified` : `applied ${d.applied} — NOT verified`}
                    sx={{
                      height: 20, fontSize: 11,
                      bgcolor: d.verified ? '#e7f5ec' : '#fdecea',
                      color: d.verified ? '#166534' : '#b3261e',
                    }} />
                )}
                <Button
                  size="small" variant="contained" sx={{ ml: 'auto' }}
                  disabled={applying === p.campaignId}
                  onClick={() => void apply(p.campaignId)}
                >
                  {applying === p.campaignId ? 'Applying…' : 'Apply to this campaign'}
                </Button>
              </Stack>

              <Divider sx={{ mb: 1.5 }} />

              <Stack spacing={1.5}>
                {p.changes.map((c, i) => (
                  <Box key={i}>
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mb: 0.5 }}>
                      <Chip size="small" label={`Email ${c.step}`} sx={{ height: 18, fontSize: 10 }} />
                      <Chip size="small" variant="outlined" label={c.field} sx={{ height: 18, fontSize: 10 }} />
                    </Stack>
                    {c.field === 'subject' ? (
                      <Box sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                        <Box sx={{ color: '#b3261e' }}>− {JSON.stringify(c.from)}</Box>
                        <Box sx={{ color: '#166534' }}>+ {JSON.stringify(c.to)}</Box>
                      </Box>
                    ) : (
                      <Typography variant="body2" sx={{ color: '#5a6675' }}>{c.why}</Typography>
                    )}
                  </Box>
                ))}
              </Stack>

              {!!p.unresolved.length && (
                <Alert severity="info" sx={{ mt: 1.5 }}>
                  Left alone because the fix is a decision, not a rename:{' '}
                  <strong>{[...new Set(p.unresolved.map((u) => u.token))].map((t) => `{{${t}}}`).join(', ')}</strong>.
                  These need a value on Email variables, or the agency website.
                </Alert>
              )}
            </Paper>
          );
        })}
      </Stack>

      {!loading && !!withChanges.length && (
        <Alert severity="info" sx={{ mt: 3 }}>
          After applying, the subject comes from the contact&apos;s own <code>subject_1</code>
          {' '}variable — so use <strong>Update the contacts with today&apos;s values</strong> on
          the campaign, or the subject will arrive blank for contacts uploaded before today.
        </Alert>
      )}
    </Container>
  );
}
