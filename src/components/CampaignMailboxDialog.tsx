'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack,
  Checkbox, FormControlLabel, Chip, CircularProgress, Alert, Divider, Tooltip,
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

export default function CampaignMailboxDialog({
  open, onClose, campaignId, selected, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  /** Mailboxes currently assigned to this campaign. */
  selected: string[];
  onSaved: (mailboxes: string[]) => void;
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
      onSaved([...picked]);
      onClose();
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

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Sending mailboxes
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Which mailboxes send this campaign
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">Loading mailboxes…</Typography>
          </Box>
        ) : (
          <>
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

            {picked.size === 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                With no mailbox selected this campaign has nothing to send from.
              </Alert>
            )}
            {missingTracking > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Some selected mailboxes have no tracking domain of their own and will fall back
                to the platform&apos;s shared one — a deliverability risk on a cold send.
              </Alert>
            )}

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
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>Cancel</Button>
        <Button
          variant="contained" onClick={save} disabled={saving || loading}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {saving ? 'Saving…' : `Save ${picked.size} mailbox${picked.size === 1 ? '' : 'es'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
