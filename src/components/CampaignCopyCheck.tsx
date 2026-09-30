'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Chip, CircularProgress, Alert, Stack, Button, Divider, Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';

/**
 * What this campaign's copy asks for, against what the CRM actually sends.
 *
 * ── Why it sits here ────────────────────────────────────────────────────────
 * The copy is written on the sending platform and the values are built in the CRM, and
 * nothing joined the two. A template can ask for a variable nobody has ever produced: the
 * platform renders it as nothing and sends the sentence with a hole in it. No error, no
 * warning, no bounce — the email looks fine leaving and wrong arriving.
 *
 * So the check lives beside the copy, on the screen where somebody is already editing it,
 * rather than in a report they would have to know to open.
 */

type Status = 'built_in' | 'sent' | 'empty' | 'stale' | 'unknown';

type Token = {
  name: string; status: Status; where: string[]; value: string | null; note: string;
  missingOn?: number; ofContacts?: number;
};

type Audit = {
  campaignName: string;
  steps: number;
  sample: { leadId: string; email: string; owner: string | null; standIn: boolean } | null;
  contacts: number;
  tokens: Token[];
  unused: string[];
  problems: number;
  error?: string;
};

const LOOK: Record<Status, { label: string; colour: string; bg: string }> = {
  unknown:  { label: 'Arrives blank',  colour: '#b3261e', bg: '#fdecea' },
  stale:    { label: 'Contact is out of date', colour: '#8a5a00', bg: '#fff4e0' },
  empty:    { label: 'Nothing to put in it', colour: '#8a5a00', bg: '#fff4e0' },
  sent:     { label: 'Filled in',      colour: '#1b6b2f', bg: '#eaf6ee' },
  built_in: { label: 'Platform fills it', colour: '#5a6675', bg: '#eef0f3' },
};

export default function CampaignCopyCheck({
  campaignId,
  reloadOn = 0,
}: {
  campaignId: string;
  /**
   * Any change to this re-runs the check.
   *
   * The parent bumps it when the sequence is saved. Without it this loaded once on mount and
   * went on describing the copy as it was when the tab opened — so a variable somebody had
   * just added showed nothing, and the fix for it appeared only after a manual page reload.
   * A check read at the moment somebody edits copy cannot be the one thing on screen that
   * has not noticed the edit.
   */
  reloadOn?: number;
}) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const j = await (await fetch(`/api/admin/campaign-copy?campaignId=${encodeURIComponent(campaignId)}`)).json();
      if (!j.success) throw new Error(j.error || 'Could not read the copy');
      setAudit(j as Audit);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the copy');
    } finally { setLoading(false); }
  }, [campaignId, reloadOn]);

  useEffect(() => { void load(); }, [load]);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  /**
   * Push today's values onto the contacts already in the campaign.
   *
   * The result is reported as it came back, failures included. "Updated 40" that quietly
   * swallowed 6 that did not take would be worse than no number — the platform answers 200
   * to a write that stored nothing, which is the whole reason each one is read back.
   */
  const resync = async () => {
    setSyncing(true); setSyncMsg(null); setError(null);
    try {
      const j = await (await fetch(
        `/api/admin/campaign-copy?campaignId=${encodeURIComponent(campaignId)}`,
        { method: 'POST' },
      )).json();
      if (!j.success) throw new Error(j.error || 'Could not update the contacts');
      setAudit(j as Audit);
      const failed = (j.failed ?? []) as Array<{ email: string; fields: string[] }>;
      setSyncMsg(
        `${j.updated + (j.sharedOnly ?? 0)} of ${j.contacts} contact(s) updated`
        + (j.sharedOnly ? ` · ${j.sharedOnly} had no matching lead, so only the shared values were sent` : '')
        + (j.skipped ? ` · ${j.skipped} skipped (nothing to send)` : '')
        + (failed.length
          ? ` · ${failed.length} did not take: ${failed.slice(0, 3).map((f) => f.email).join(', ')}`
          : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the contacts');
    } finally { setSyncing(false); }
  };

  if (loading) return <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={22} /></Box>;
  if (error) return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  if (!audit) return null;
  if (audit.error) return <Alert severity="info" sx={{ mb: 2 }}>{audit.error}</Alert>;

  const bad = audit.tokens.filter(
    (t) => t.status === 'unknown' || t.status === 'empty' || t.status === 'stale',
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Variables in this copy
        </Typography>
        <Tooltip title="Re-read the copy from the sending platform">
          <Button size="small" onClick={() => void load()}><RefreshIcon fontSize="small" /></Button>
        </Tooltip>
      </Stack>

      {audit.problems === 0 ? (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 1 }}>
          Every variable in this copy has a value. Nothing will arrive blank.
        </Alert>
      ) : (
        <Alert severity="error" sx={{ mb: 1 }}>
          <strong>{audit.problems} variable{audit.problems === 1 ? '' : 's'} will arrive blank.</strong>{' '}
          The platform prints nothing for a variable it was not given, and the sentence still
          sends — so this is only visible here.
        </Alert>
      )}

      {/*
        Named against a real contact, so the answer is about an account this campaign is
        actually going to mail rather than about the catalogue. "band_low is a known field"
        and "band_low has a value on this account" are different statements, and only the
        second one predicts what lands in somebody's inbox.
      */}
      <Stack spacing={0.75}>
        {audit.tokens.map((t) => (
          <Box key={t.name} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Chip
              size="small" label={LOOK[t.status].label}
              sx={{ height: 20, fontSize: 11, fontWeight: 700, minWidth: 138,
                    bgcolor: LOOK[t.status].bg, color: LOOK[t.status].colour }}
            />
            <Typography sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {`{{${t.name}}}`}
            </Typography>
            {t.value && (
              <Typography variant="body2" sx={{ color: '#1b6b2f' }}>= {t.value}</Typography>
            )}
            <Typography variant="caption" sx={{ color: '#8a8f98' }}>
              {t.where.join(' · ')}
            </Typography>
            {(t.status === 'unknown' || t.status === 'empty' || t.status === 'stale') && (
              <Typography variant="caption" sx={{ color: '#8a5a00', width: '100%', pl: '150px' }}>
                {t.note}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>

      {/*
        Offered only when something is actually stale.

        Re-syncing writes to every contact in the campaign, so it is not a button to leave
        lying around for somebody to press hopefully — it appears when there is a specific
        thing it will fix, and says what that is.
      */}
      {audit.tokens.some((t) => t.status === 'stale') && (
        <Box sx={{ mt: 1.5, p: 1.5, border: '1px solid #f0d9a8', borderRadius: 1, bgcolor: '#fffaf0' }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            The contacts in this campaign were uploaded before these values were set. Sending
            them again now will still leave a blank — the values have to be pushed onto the
            contacts first.
          </Typography>
          <Button size="small" variant="contained" color="warning" disabled={syncing}
            onClick={() => void resync()}
          >
            {syncing ? 'Updating contacts…' : 'Update the contacts with today’s values'}
          </Button>
          {syncMsg && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
              {syncMsg}
            </Typography>
          )}
        </Box>
      )}

      {bad.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" sx={{ color: '#5a6675' }}>
            To fix a blank: either change the copy to a variable the CRM sends, or tell us what
            should fill it. A name the CRM has never heard of can never be filled in, however
            many times the campaign runs.
          </Typography>
        </>
      )}

      {audit.unused.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          {/*
            The other half of the same question. An unused variable costs nothing, but it is
            how somebody notices the copy says {{renewal_month}} while the CRM sends {{month}}.
          */}
          <Typography variant="caption" sx={{ color: '#5a6675' }}>
            <b>Available but not used in this copy:</b> {audit.unused.join(', ')}
          </Typography>
        </>
      )}
    </Paper>
  );
}
