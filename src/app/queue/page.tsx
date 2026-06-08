'use client';

import React, { useEffect, useState } from 'react';
import {
  Container, Box, Typography, Tabs, Tab, Chip,
  CircularProgress, Alert, Card, CardContent, Stack, Grid,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import LeadsTable from '@/components/LeadsTable';

type QueueTab = 'quoteReady' | 'needsInfo';

export default function QueuePage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>('quoteReady');

  useEffect(() => {
    fetch('/api/leads?source=db&size=100')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setLeads(d.data || []);
        else setError(d.error || 'Failed to load leads');
      })
      .catch(() => setError('Failed to load queue'))
      .finally(() => setLoading(false));
  }, []);

  const quoteReady = leads.filter((l) => l.grade === 'A');
  const needsInfo   = leads.filter((l) => l.grade === 'B' || l.grade === 'C');

  const displayLeads = activeTab === 'quoteReady' ? quoteReady : needsInfo;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>
          Lead Queues
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Carrier-qualified leads sorted by readiness
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #2e7d32' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <FactCheckIcon sx={{ fontSize: 36, color: '#2e7d32', mb: 1 }} />
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
                {loading ? '…' : quoteReady.length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Quote Ready</Typography>
              <Typography variant="caption" color="textSecondary">Grade A — all fields complete</Typography>
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
              <Typography variant="caption" color="textSecondary">Grade B/C — passes carriers, missing fields</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #1565c0' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#1565c0' }}>
                {loading ? '…' : leads.filter((l) => l.travelersEligible === 'eligible').length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Travelers Eligible</Typography>
              <Typography variant="caption" color="textSecondary">Confirmed eligible for Travelers</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ boxShadow: 2, borderTop: '4px solid #6a1b9a' }}>
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#6a1b9a' }}>
                {loading ? '…' : leads.filter((l) => l.plymouthEligible === 'eligible').length}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>Plymouth Rock Eligible</Typography>
              <Typography variant="caption" color="textSecondary">Confirmed eligible for Plymouth Rock</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Queue Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
          <Tab
            icon={<FactCheckIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Quote Ready Queue</span>
                <Chip
                  label={quoteReady.length}
                  size="small"
                  sx={{ height: 18, fontSize: '0.7rem', backgroundColor: '#c8e6c9', color: '#1b5e20' }}
                />
              </Stack>
            }
            value="quoteReady"
          />
          <Tab
            icon={<PendingActionsIcon />}
            iconPosition="start"
            label={
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <span>Needs Information Queue</span>
                <Chip
                  label={needsInfo.length}
                  size="small"
                  sx={{ height: 18, fontSize: '0.7rem', backgroundColor: '#fff3e0', color: '#e65100' }}
                />
              </Stack>
            }
            value="needsInfo"
          />
        </Tabs>
      </Box>

      {activeTab === 'quoteReady' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <strong>Grade A — Quote Ready:</strong> These leads pass at least one carrier's appetite and have all critical fields. Producers can contact these homeowners and present indicative pricing immediately.
        </Alert>
      )}
      {activeTab === 'needsInfo' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Grade B/C — Needs Information:</strong> These leads pass carrier appetite but are missing 1 or more critical fields. Enrichment or skip trace may resolve them.
        </Alert>
      )}

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
