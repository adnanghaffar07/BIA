'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Typography, Box, Stack, Checkbox, FormControlLabel, Chip,
  CircularProgress, Alert, Divider, Tooltip, Paper,
} from '@mui/material';

/**
 * Choose which sending mailboxes a campaign uses.
 *
 * Grouped by domain because that is how deliverability behaves: mailboxes on one
 * domain share its reputation and its tracking domain, so picking "some of this
 * domain" is a meaningfully different decision from picking "this domain".
 *
 * Only mailboxes the platform will actually send from are selectable. One still being
 * provisioned reports setup_pending and is shown disabled rather than hidden, so the
 * count on screen always matches the count in the platform.
 *
 * Rendered inline as a tab panel; unsaved picks are reported through onDirtyChange so
 * the page can guard the tab switch.
 */

export type Mailbox = {
  email: string;
  domain: string;
  name: string | null;
  active: boolean;
  warmingUp: boolean;
  warmupScore: number | null;
  dailyLimit: number;
  trackingDomain: string | null;
};

export default function CampaignMailboxPanel({
  campaignId, selected, onSaved, onDirtyChange,
}: {
  campaignId: string;
  /** Mailboxes currently assigned to this campaign. */
  selected: string[];
  onSaved: (mailboxes: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/lead-campaigns/accounts')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.error || 'Could not load mailboxes');
        setMailboxes(j.mailboxes ?? []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load mailboxes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const dirty = useMemo(() => {
    if (picked.size !== selected.length) return true;
    return selected.some((e) => !picked.has(e));
  }, [picked, selected]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const byDomain = useMemo(() => {
    const map = new Map<string, Mailbox[]>();
    for (const m of mailboxes) {
      const list = map.get(m.domain) ?? [];
      list.push(m);
      map.set(m.domain, list);
    }
    return [...map.entries()];
  }, [mailboxes]);

  const toggle = (email: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const toggleDomain = (domain: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const m of mailboxes) {
        if (m.domain !== domain || !m.active) continue;
        if (on) next.add(m.email); else next.delete(m.email);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mailboxes: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save the mailbox selection');
      onDirtyChange?.(false);
      onSaved([...picked]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the mailbox selection');
    } finally {
      setSaving(false);
    }
  };

  // Capacity of what is actually selected — the number that decides how long a
  // cohort takes to get through, which is the reason to pick more mailboxes.
  const chosenCapacity = mailboxes
    .filter((m) => picked.has(m.email))
    .reduce((s, m) => s + m.dailyLimit, 0);
  const missingTracking = mailboxes.filter((m) => picked.has(m.email) && !m.trackingDomain).length;

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading mailboxes…</Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Box sx={{ maxWidth: 760 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
          <Chip size="small" label={`${picked.size} selected`} sx={{ fontWeight: 600 }} />
          <Chip
            size="small"
            label={`${chosenCapacity.toLocaleString()} sends/day`}
            sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }}
          />
          {missingTracking > 0 && (
            <Chip
              size="small"
              label={`${missingTracking} without a tracking domain`}
              sx={{ bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 }}
            />
          )}
        </Stack>

        {byDomain.map(([domain, list], i) => {
          const selectable = list.filter((m) => m.active);
          const allOn = selectable.length > 0 && selectable.every((m) => picked.has(m.email));
          const someOn = selectable.some((m) => picked.has(m.email));
          return (
            <Box key={domain} sx={{ mb: 2 }}>
              {i > 0 && <Divider sx={{ mb: 2 }} />}
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={allOn}
                      indeterminate={someOn && !allOn}
                      onChange={(e) => toggleDomain(domain, e.target.checked)}
                    />
                  }
                  label={<Typography sx={{ fontWeight: 700 }}>{domain}</Typography>}
                />
                <Chip
                  size="small"
                  label={list[0]?.trackingDomain ?? 'no tracking domain'}
                  sx={{
                    height: 20, fontSize: 11, fontWeight: 600,
                    bgcolor: list[0]?.trackingDomain ? '#dcfce7' : '#fee2e2',
                    color: list[0]?.trackingDomain ? '#166534' : '#b3261e',
                  }}
                />
              </Stack>

              <Stack sx={{ pl: 3 }}>
                {list.map((m) => (
                  <Tooltip key={m.email} title={m.active ? '' : 'Still being set up on the platform — cannot send yet'}>
                    <span>
                      <FormControlLabel
                        disabled={!m.active}
                        control={
                          <Checkbox size="small" checked={picked.has(m.email)} onChange={() => toggle(m.email)} />
                        }
                        label={
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography variant="body2">{m.email}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {m.dailyLimit}/day
                              {m.warmupScore != null ? ` · warmup ${m.warmupScore}` : ''}
                            </Typography>
                          </Stack>
                        }
                      />
                    </span>
                  </Tooltip>
                ))}
              </Stack>
            </Box>
          );
        })}

        <Divider sx={{ mb: 2 }} />
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Button
            variant="contained" onClick={save} disabled={saving || !dirty}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {saving ? 'Saving…' : `Save ${picked.size} mailbox${picked.size === 1 ? '' : 'es'}`}
          </Button>
          {dirty && !saving && <Typography variant="caption" color="warning.main">Unsaved changes</Typography>}
        </Stack>
      </Box>
    </Paper>
  );
}
