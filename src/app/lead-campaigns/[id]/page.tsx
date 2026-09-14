'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Container, Box, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody,
  Chip, CircularProgress, Alert, Stack, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Tooltip, Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import RefreshIcon from '@mui/icons-material/Refresh';
import OutboxIcon from '@mui/icons-material/Outbox';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CampaignPushDialog from '@/components/CampaignPushDialog';
import CampaignCsvImportDialog from '@/components/CampaignCsvImportDialog';
import CampaignMailboxDialog from '@/components/CampaignMailboxDialog';

/**
 * One campaign, managed from the CRM: its settings, its leads, and every lifecycle
 * action. Each control calls exactly one narrow route.
 */

type Detail = {
  id: string; name: string; status: number; statusLabel: string;
  dailyLimit: number | null; stopOnReply: boolean | null; unsubscribeHeader: boolean | null;
  linkTracking: boolean | null; openTracking: boolean | null;
  mailboxes: string[]; steps: number; firstSubject: string | null;
};

type LeadRow = {
  id: string; email: string; status: number | null; opens: number; replies: number;
  clicks: number; lastContact: string | null; firstName: string | null; lastName: string | null;
  propertyId: string | null;
};

const ACTIVE = 1;

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [totals, setTotals] = useState<{ count: number; replied: number; opened: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [newLead, setNewLead] = useState({ email: '', firstName: '', lastName: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dRes, lRes] = await Promise.all([
        fetch(`/api/lead-campaigns/${id}`),
        fetch(`/api/lead-campaigns/${id}/leads`),
      ]);
      const dJson = await dRes.json();
      if (!dRes.ok) throw new Error(dJson.error || 'Could not load the campaign');
      setDetail(dJson.data);
      const lJson = await lRes.json();
      if (lRes.ok) {
        setLeads(lJson.data ?? []);
        setTotals({ count: lJson.count ?? 0, replied: lJson.replied ?? 0, opened: lJson.opened ?? 0 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const act = async (action: 'pause' | 'activate' | 'duplicate') => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${id}/${action}`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Could not ${action} the campaign`);
      if (action === 'duplicate') {
        setNotice('Campaign duplicated. The copy is paused and starts empty of sends.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} the campaign`);
    } finally {
      setBusy(null);
    }
  };

  const addLead = async () => {
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${id}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newLead),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not add the lead');
      // Skips are reported, never silent — a lead already in another campaign is the
      // common case and the operator needs to know it did not land.
      const skipped = (json.skipped ?? [])[0];
      setNotice(
        json.added > 0
          ? `Added ${newLead.email}.`
          : skipped
            ? `Not added — ${skipped.reason}.`
            : 'Nothing was added.',
      );
      setNewLead({ email: '', firstName: '', lastName: '' });
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the lead');
    } finally {
      setBusy(null);
    }
  };

  const removeCampaign = async () => {
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not delete the campaign');
      router.push('/lead-campaigns');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the campaign');
      setBusy(null);
    }
  };

  const isActive = detail?.status === ACTIVE;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => router.push('/lead-campaigns')} sx={{ mb: 2 }}>
        All campaigns
      </Button>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {loading && !detail ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : detail ? (
        <>
          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold' }}>{detail.name}</Typography>
            <Chip
              label={detail.statusLabel} size="small"
              sx={{
                fontWeight: 700,
                bgcolor: isActive ? '#dcfce7' : '#e8eaed',
                color: isActive ? '#166534' : '#5c6b78',
              }}
            />
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 3 }}>
            {isActive ? (
              <Button
                size="small" variant="outlined" color="warning" startIcon={<PauseIcon />}
                onClick={() => act('pause')} disabled={!!busy}
              >
                {busy === 'pause' ? 'Pausing…' : 'Pause'}
              </Button>
            ) : (
              <Tooltip
                title={
                  detail.steps === 0 ? 'This campaign has no email step yet — it cannot send.'
                  : detail.mailboxes.length === 0 ? 'No sending mailbox is assigned.'
                  : ''
                }
              >
                <span>
                  <Button
                    size="small" variant="contained" color="success" startIcon={<PlayArrowIcon />}
                    onClick={() => act('activate')}
                    disabled={!!busy || detail.steps === 0 || detail.mailboxes.length === 0}
                  >
                    {busy === 'activate' ? 'Activating…' : 'Activate'}
                  </Button>
                </span>
              </Tooltip>
            )}
            <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => act('duplicate')} disabled={!!busy}>
              {busy === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
            </Button>
            <Button size="small" variant="contained" startIcon={<GroupAddIcon />} onClick={() => setPushOpen(true)} disabled={!!busy}>
              Add leads from CRM
            </Button>
            <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setCsvOpen(true)} disabled={!!busy}>
              Import CSV
            </Button>
            <Button size="small" variant="outlined" startIcon={<PersonAddAlt1Icon />} onClick={() => setAddOpen(true)} disabled={!!busy}>
              Add one lead
            </Button>
            <Button size="small" variant="outlined" startIcon={<OutboxIcon />} onClick={() => setMailboxOpen(true)} disabled={!!busy}>
              Sending mailboxes
            </Button>
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={!!busy || loading}>
              Refresh
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setDeleteOpen(true)} disabled={!!busy}>
              Delete
            </Button>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip size="small" label={`${totals?.count ?? 0} leads`} sx={{ fontWeight: 600 }} />
              <Chip size="small" label={`${totals?.opened ?? 0} opened`} />
              <Chip size="small" label={`${totals?.replied ?? 0} replied`} sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
              <Divider orientation="vertical" flexItem />
              <Chip size="small" variant="outlined" label={`${detail.steps} step${detail.steps === 1 ? '' : 's'}`} />
              <Chip
                size="small" clickable onClick={() => setMailboxOpen(true)}
                variant={detail.mailboxes.length === 0 ? 'filled' : 'outlined'}
                label={`${detail.mailboxes.length} mailbox${detail.mailboxes.length === 1 ? '' : 'es'}`}
                sx={detail.mailboxes.length === 0 ? { bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 } : undefined}
              />
              {detail.dailyLimit != null && <Chip size="small" variant="outlined" label={`${detail.dailyLimit}/day`} />}
              <Chip
                size="small"
                label={detail.unsubscribeHeader ? 'Unsubscribe header on' : 'No unsubscribe header'}
                sx={{
                  fontWeight: 600,
                  bgcolor: detail.unsubscribeHeader ? '#dcfce7' : '#fee2e2',
                  color: detail.unsubscribeHeader ? '#166534' : '#b3261e',
                }}
              />
            </Stack>
            {detail.mailboxes.length === 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                No sending mailbox is assigned, so this campaign cannot send. Pick one before
                activating it.
              </Alert>
            )}
            {!detail.unsubscribeHeader && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                This campaign sends without a one-click unsubscribe header. That is a
                compliance and deliverability problem — turn it on before activating.
              </Alert>
            )}
            {detail.firstSubject && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                First subject: <strong>{detail.firstSubject}</strong>
              </Typography>
            )}
          </Paper>

          <Typography variant="h6" sx={{ mb: 1 }}>Leads</Typography>
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Email', 'Name', 'Opens', 'Replies', 'Clicks', 'Last contact', 'CRM lead'].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell>{l.email}</TableCell>
                    <TableCell>{[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{l.opens}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: l.replies > 0 ? 700 : 400, color: l.replies > 0 ? '#166534' : undefined }}>
                      {l.replies}
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{l.clicks}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                      {l.lastContact ? String(l.lastContact).slice(0, 10) : '—'}
                    </TableCell>
                    <TableCell>
                      {l.propertyId
                        ? <a href={`/leads/${l.propertyId}`} style={{ color: '#1565c0' }}>open</a>
                        : <span style={{ color: '#b0b6c0' }}>—</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: '#888' }}>
                      No leads in this campaign yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </>
      ) : null}

      {/* Add one lead by hand */}
      <Dialog open={addOpen} onClose={busy ? undefined : () => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add a lead</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="Email" size="small" fullWidth autoFocus value={newLead.email}
              onChange={(e) => setNewLead((n) => ({ ...n, email: e.target.value }))}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField label="First name" size="small" fullWidth value={newLead.firstName} onChange={(e) => setNewLead((n) => ({ ...n, firstName: e.target.value }))} />
              <TextField label="Last name" size="small" fullWidth value={newLead.lastName} onChange={(e) => setNewLead((n) => ({ ...n, lastName: e.target.value }))} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Checked against every campaign on the platform first — an address already in
              one is reported back rather than added twice.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} color="inherit" disabled={!!busy}>Cancel</Button>
          <Button variant="contained" onClick={addLead} disabled={!!busy || !newLead.email.trim()}>
            {busy === 'add' ? 'Adding…' : 'Add lead'}
          </Button>
        </DialogActions>
      </Dialog>

      {csvOpen && detail && (
        <CampaignCsvImportDialog
          open
          campaignId={detail.id}
          campaignName={detail.name}
          onClose={() => setCsvOpen(false)}
          onFinished={(t) => {
            setNotice(`${t.added} lead${t.added === 1 ? '' : 's'} imported from CSV.`);
            load();
          }}
        />
      )}

      {pushOpen && detail && (
        <CampaignPushDialog
          open
          campaignId={detail.id}
          campaignName={detail.name}
          onClose={() => setPushOpen(false)}
          onFinished={(t) => {
            setNotice(`${t.pushed} lead${t.pushed === 1 ? '' : 's'} added from the CRM.`);
            load();
          }}
        />
      )}

      {mailboxOpen && detail && (
        <CampaignMailboxDialog
          open
          campaignId={detail.id}
          selected={detail.mailboxes}
          onClose={() => setMailboxOpen(false)}
          onSaved={(mb) => {
            setNotice(`Now sending from ${mb.length} mailbox${mb.length === 1 ? '' : 'es'}.`);
            load();
          }}
        />
      )}

      {/* Delete, name-confirmed */}
      <Dialog open={deleteOpen} onClose={busy ? undefined : () => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this campaign?</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            This removes the campaign and its leads and history from the platform. It cannot
            be undone.
          </Alert>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Type <strong>{detail?.name}</strong> to confirm.
          </Typography>
          <TextField size="small" fullWidth value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} color="inherit" disabled={!!busy}>Cancel</Button>
          <Button
            variant="contained" color="error" onClick={removeCampaign}
            disabled={!!busy || confirmName !== detail?.name}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete campaign'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
