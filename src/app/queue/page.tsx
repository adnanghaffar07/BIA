'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  Container, Box, Typography, Tabs, Tab, Chip,
  CircularProgress, Alert, Card, CardContent, Stack, Grid, Tooltip,
  FormControl, InputLabel, Select, MenuItem, TextField, Button,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HistoryIcon from '@mui/icons-material/History';
import LeadsTable from '@/components/LeadsTable';

type QueueTab = 'quoteReady' | 'needsInfo' | 'closed' | 'edited';

interface StockHealth {
  quoteReadyActive: number;
  workingStock: number;
  boundLast30: number;
  staleLeads: number;
  bufferDays: number | null;
  stockFlowRatio: number | null;
  dailyBurnRate: number;
}

export default function QueuePage() {
  const [activeLeads, setActiveLeads]   = useState<any[]>([]);
  const [closedLeads, setClosedLeads]   = useState<any[]>([]);
  const [editedLeads, setEditedLeads]   = useState<any[]>([]);
  const [stock,       setStock]         = useState<StockHealth | null>(null);
  const [loading,     setLoading]       = useState(true);
  const [error,       setError]         = useState<string | null>(null);
  const [activeTab,   setActiveTab]     = useState<QueueTab>('quoteReady');
  const [carrier,     setCarrier]       = useState('');
  const [effFrom,     setEffFrom]       = useState('');
  const [effTo,       setEffTo]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // size is uncapped so the queue counts/cards reflect the full working set
      // (a 200-row cap previously under-counted Quote-Ready vs the dashboard).
      // Effective-date range (Frank Jul-2026): a pull covers a 7-day window, so the
      // queue needs From/To, not a single day. Blank "to" = that one day only.
      const eff = new URLSearchParams();
      if (effFrom) eff.set('effectiveDate', effFrom);
      if (effTo) eff.set('effectiveTo', effTo);
      const effQs = eff.toString() ? `&${eff.toString()}` : '';

      const [activeRes, closedRes, editedRes, dashRes] = await Promise.all([
        fetch(`/api/leads?source=db&size=100000&active=true&orderBy=xdate${effQs}`),
        fetch(`/api/leads?source=db&size=100000&closed=true&orderBy=updated${effQs}`),
        fetch(`/api/leads?source=db&size=200&editedOnly=true&orderBy=edited${effQs}`),
        fetch('/api/dashboard'),
      ]);
      const [activeJson, closedJson, editedJson, dashJson] = await Promise.all([
        activeRes.json(), closedRes.json(), editedRes.json(), dashRes.json(),
      ]);
      if (activeJson.success) setActiveLeads(activeJson.data || []);
      else setError(activeJson.error || 'Failed to load active leads');
      if (closedJson.success) setClosedLeads(closedJson.data || []);
      if (editedJson.success) setEditedLeads(editedJson.data || []);
      if (dashJson.success) {
        const d = dashJson.data;
        setStock({
          quoteReadyActive: d.quoteReadyActive,
          workingStock:     d.workingStock,
          boundLast30:      d.boundLast30,
          staleLeads:       d.staleLeads,
          bufferDays:       d.bufferDays,
          stockFlowRatio:   d.stockFlowRatio,
          dailyBurnRate:    d.dailyBurnRate,
        });
      }
    } catch {
      setError('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [effFrom, effTo]);

  useEffect(() => { load(); }, [load]);

  // Open a specific tab when arrived via ?tab= (e.g. "Back to Lead Queue" from a
  // lead detail page lands on Recently Edited).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && ['quoteReady', 'needsInfo', 'closed', 'edited'].includes(t)) setActiveTab(t as QueueTab);
  }, []);

  // Carrier filter (client-side): show only leads strictly eligible for the
  // selected carrier (status 'eligible').
  const carrierOk = (l: any) => {
    if (!carrier) return true;
    const v = carrier === 'travelers' ? l.travelersEligible : l.plymouthEligible;
    return v === 'eligible';
  };
  const active     = activeLeads.filter(carrierOk);
  const closed     = closedLeads.filter(carrierOk);
  const edited     = editedLeads.filter(carrierOk);
  const quoteReady = active.filter((l) => l.grade === 'A');
  const needsInfo  = active.filter((l) => l.grade === 'B' || l.grade === 'C');
  const bound      = closed.filter((l) => l.status === 'bound');
  const lost       = closed.filter((l) => l.status === 'lost');

  const displayLeads =
    activeTab === 'quoteReady' ? quoteReady :
    activeTab === 'needsInfo'  ? needsInfo  :
    activeTab === 'edited'     ? edited     :
    closed;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>Lead Queues</Typography>
        <Typography variant="body1" color="text.secondary">
          Active leads sorted by soonest renewal date · bound/lost leads moved to Closed
        </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {/* ── Buffer / Stock health bar ───────────────────────────────────────── */}
      {stock && (() => {
        const bufferDays = stock.bufferDays;
        const bufferSeverity =
          bufferDays == null ? 'info' as const :
          bufferDays < 7     ? 'error' as const :
          bufferDays < 14    ? 'warning' as const :
          'success' as const;

        const bufferText =
          bufferDays == null
            ? 'No sales recorded yet — lead supply not yet measurable'
            : bufferDays < 7
            ? `Almost out of leads: only ${bufferDays} days left — pull new leads now`
            : bufferDays < 14
            ? `Running low: ${bufferDays} days of leads left — schedule a pull soon`
            : `Healthy: ${bufferDays} days of leads queued ahead`;

        const ratioText = stock.stockFlowRatio != null
          ? ` · Pipeline coverage ${stock.stockFlowRatio}× (target 0.5–0.75×)`
          : '';

        const staleText = stock.staleLeads > 0
          ? ` · ${stock.staleLeads} lead${stock.staleLeads > 1 ? 's' : ''} untouched 14+ days`
          : '';

        return (
          <Alert
            severity={bufferSeverity}
            icon={bufferSeverity !== 'success' ? <WarningAmberIcon /> : undefined}
            sx={{ mb: 3, alignItems: 'center' }}
            action={
              stock.staleLeads > 0 ? (
                <Tooltip title={`${stock.staleLeads} Grade A leads have been in the queue for >14 days with no first contact. Consider retiring or prioritizing them.`}>
                  <Chip
                    label={`${stock.staleLeads} stale`}
                    size="small"
                    color="warning"
                    icon={<WarningAmberIcon />}
                    sx={{ cursor: 'help' }}
                  />
                </Tooltip>
              ) : undefined
            }
          >
            {bufferText}{ratioText}{staleText}
          </Alert>
        );
      })()}

      {/* ── Summary Cards ──────────────────────────────────────────────────── */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #2e7d32' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <FactCheckIcon sx={{ fontSize: 36, color: '#2e7d32', mb: 1 }} />
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
                {loading ? '…' : quoteReady.length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Quote Ready</Typography>
              <Typography variant="caption" color="text.secondary">Grade A — active, sorted by renewal date</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #f57c00' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <PendingActionsIcon sx={{ fontSize: 36, color: '#f57c00', mb: 1 }} />
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#f57c00' }}>
                {loading ? '…' : needsInfo.length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Needs Information</Typography>
              <Typography variant="caption" color="text.secondary">Grade B/C — missing fields</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #1565c0' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <CheckCircleIcon sx={{ fontSize: 36, color: '#1565c0', mb: 1 }} />
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#1565c0' }}>
                {loading ? '…' : bound.length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Bound</Typography>
              <Typography variant="caption" color="text.secondary">Policies issued</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #c62828' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <CancelIcon sx={{ fontSize: 36, color: '#c62828', mb: 1 }} />
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#c62828' }}>
                {loading ? '…' : lost.length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Lost</Typography>
              <Typography variant="caption" color="text.secondary">Retired from queue</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── Tabs: dropdown on mobile, tabs on desktop (mirrors Leads page) ───── */}
      <FormControl size="small" fullWidth sx={{ display: { xs: 'flex', md: 'none' }, mb: 2.5 }}>
        <InputLabel id="queue-tab-label">View</InputLabel>
        <Select
          labelId="queue-tab-label"
          label="View"
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value as QueueTab)}
        >
          <MenuItem value="quoteReady">Quote Ready ({quoteReady.length})</MenuItem>
          <MenuItem value="needsInfo">Needs Information ({needsInfo.length})</MenuItem>
          <MenuItem value="closed">Closed ({closedLeads.length})</MenuItem>
          <MenuItem value="edited">Recently Edited ({edited.length})</MenuItem>
        </Select>
      </FormControl>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, display: { xs: 'none', md: 'block' } }}>
        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          <Tab
            icon={<FactCheckIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Quote Ready Queue</span>
                <Chip label={quoteReady.length} size="small"
                  sx={{ height: 18, fontSize: '0.7rem', bgcolor: '#c8e6c9', color: '#1b5e20' }} />
              </Stack>
            }
            value="quoteReady"
          />
          <Tab
            icon={<PendingActionsIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Needs Information</span>
                <Chip label={needsInfo.length} size="small"
                  sx={{ height: 18, fontSize: '0.7rem', bgcolor: '#fff3e0', color: '#e65100' }} />
              </Stack>
            }
            value="needsInfo"
          />
          <Tab
            icon={<CheckCircleIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Closed</span>
                <Chip label={closedLeads.length} size="small"
                  sx={{ height: 18, fontSize: '0.7rem', bgcolor: '#e8eaf6', color: '#283593' }} />
              </Stack>
            }
            value="closed"
          />
          <Tab
            icon={<HistoryIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Recently Edited</span>
                <Chip label={edited.length} size="small"
                  sx={{ height: 18, fontSize: '0.7rem', bgcolor: '#e1f5fe', color: '#0277bd' }} />
              </Stack>
            }
            value="edited"
          />
        </Tabs>
      </Box>

      {/* ── Context alerts ─────────────────────────────────────────────────── */}
      {activeTab === 'quoteReady' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <strong>Grade A — Quote Ready:</strong> Sorted by soonest renewal date — leads renewing soonest are at the top.
          Bound and lost leads have been removed from this view.
        </Alert>
      )}
      {activeTab === 'needsInfo' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Grade B/C — Needs Information:</strong> Pass carrier appetite but missing 1+ critical fields.
          Enrichment or a quick call may resolve them. Sorted by renewal date.
        </Alert>
      )}
      {activeTab === 'closed' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Closed leads</strong> — bound policies and lost leads. Use this view to review variance data and lost reasons.
        </Alert>
      )}
      {activeTab === 'edited' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Recently Edited</strong> — leads a producer saved from the detail page, most recent at the top.
          Jump back to a lead you just worked. (Bulk data pulls don&apos;t appear here — only human edits.)
        </Alert>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <LeadsTable
          leads={displayLeads}
          loading={loading}
          resetKey={activeTab}
          extraFilters={
            <>
              {/* Effective-date range — work a whole pull window, or a single day */}
              <TextField
                label="Effective From" type="date" size="small" sx={{ width: 160 }}
                value={effFrom} onChange={(e) => setEffFrom(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Effective To" type="date" size="small" sx={{ width: 160 }}
                value={effTo} onChange={(e) => setEffTo(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Carrier</InputLabel>
                <Select value={carrier} label="Carrier" onChange={(e) => setCarrier(e.target.value)}>
                  <MenuItem value="">All Carriers</MenuItem>
                  <MenuItem value="travelers">Travelers</MenuItem>
                  <MenuItem value="plymouth">Plymouth Rock</MenuItem>
                </Select>
              </FormControl>
              {(effFrom || effTo || carrier) && (
                <Button
                  size="small" color="inherit"
                  onClick={() => { setEffFrom(''); setEffTo(''); setCarrier(''); }}
                >
                  Clear
                </Button>
              )}
            </>
          }
        />
      )}
    </Container>
  );
}
