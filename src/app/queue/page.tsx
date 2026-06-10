'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Container, Box, Typography, Tabs, Tab, Chip,
  CircularProgress, Alert, Card, CardContent, Stack, Grid, Tooltip,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LeadsTable from '@/components/LeadsTable';

type QueueTab = 'quoteReady' | 'needsInfo' | 'closed';

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
  const [stock,       setStock]         = useState<StockHealth | null>(null);
  const [loading,     setLoading]       = useState(true);
  const [error,       setError]         = useState<string | null>(null);
  const [activeTab,   setActiveTab]     = useState<QueueTab>('quoteReady');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeRes, closedRes, dashRes] = await Promise.all([
        fetch('/api/leads?source=db&size=200&active=true&orderBy=xdate'),
        fetch('/api/leads?source=db&size=200&closed=true&orderBy=updated'),
        fetch('/api/dashboard'),
      ]);
      const [activeJson, closedJson, dashJson] = await Promise.all([
        activeRes.json(), closedRes.json(), dashRes.json(),
      ]);
      if (activeJson.success) setActiveLeads(activeJson.data || []);
      else setError(activeJson.error || 'Failed to load active leads');
      if (closedJson.success) setClosedLeads(closedJson.data || []);
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
  }, []);

  useEffect(() => { load(); }, [load]);

  const quoteReady = activeLeads.filter((l) => l.grade === 'A');
  const needsInfo  = activeLeads.filter((l) => l.grade === 'B' || l.grade === 'C');
  const bound      = closedLeads.filter((l) => l.status === 'bound');
  const lost       = closedLeads.filter((l) => l.status === 'lost');

  const displayLeads =
    activeTab === 'quoteReady' ? quoteReady :
    activeTab === 'needsInfo'  ? needsInfo  :
    closedLeads;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>Lead Queues</Typography>
        <Typography variant="body1" color="text.secondary">
          Active leads sorted by x-date proximity · bound/lost leads moved to Closed
        </Typography>
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
            ? 'Buffer unknown — no binds recorded yet'
            : bufferDays < 7
            ? `Buffer critical: only ${bufferDays} days of leads ahead — trigger a data pull now`
            : bufferDays < 14
            ? `Buffer low: ${bufferDays} days of leads ahead — schedule a data pull soon`
            : `Buffer healthy: ${bufferDays} days of leads queued ahead`;

        const ratioText = stock.stockFlowRatio != null
          ? ` · Stock/flow ${stock.stockFlowRatio}× (target 0.5–0.75×)`
          : '';

        const staleText = stock.staleLeads > 0
          ? ` · ${stock.staleLeads} stale lead${stock.staleLeads > 1 ? 's' : ''} (>14d untouched)`
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
              <Typography variant="caption" color="text.secondary">Grade A — active, sorted by x-date</Typography>
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

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
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
        </Tabs>
      </Box>

      {/* ── Context alerts ─────────────────────────────────────────────────── */}
      {activeTab === 'quoteReady' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <strong>Grade A — Quote Ready:</strong> Sorted by x-date proximity — leads with the soonest policy renewal are at the top.
          Bound and lost leads have been removed from this view.
        </Alert>
      )}
      {activeTab === 'needsInfo' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Grade B/C — Needs Information:</strong> Pass carrier appetite but missing 1+ critical fields.
          Enrichment or a quick call may resolve them. Sorted by x-date.
        </Alert>
      )}
      {activeTab === 'closed' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>Closed leads</strong> — bound policies and lost leads. Use this view to review variance data and lost reasons.
        </Alert>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <LeadsTable leads={displayLeads} loading={loading} fetchSize={50} />
      )}
    </Container>
  );
}
