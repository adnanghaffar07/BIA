'use client';

import React, { useEffect, useState } from 'react';
import {
  Container, Box, Alert, CircularProgress, Typography, Button,
  Snackbar, Tabs, Tab, Chip, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import SearchForm from '@/components/SearchForm';
import LeadsTable from '@/components/LeadsTable';
import { LeadFilters } from '@/types/lead';
import { ERROR_MESSAGES } from '@/lib/constants';

type TabValue = 'all' | 'engine1' | 'engine2';

export default function LeadsPage() {
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ total: number; engine1: number; engine2: number }>({ total: 0, engine1: 0, engine2: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ grade?: string; status?: string; size: number; effectiveDate?: string }>({ size: 100 });
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const engineForTab = (t: TabValue): 1 | 2 | undefined => (t === 'engine1' ? 1 : t === 'engine2' ? 2 : undefined);

  useEffect(() => {
    fetchLeads('all', { size: 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLeads = async (tab: TabValue, f: { grade?: string; status?: string; size: number; effectiveDate?: string }) => {
    try {
      setLoading(true);
      setError(null);

      // Always read from DB — REAPI is locked after one-time seed
      const url = new URL('/api/leads', window.location.origin);
      url.searchParams.set('source', 'db');
      url.searchParams.set('size', String(f.size || 100));
      const engine = engineForTab(tab);
      if (engine) url.searchParams.set('engine', String(engine));
      if (f.grade) url.searchParams.set('grade', f.grade);
      if (f.status) url.searchParams.set('status', f.status);
      if (f.effectiveDate) { url.searchParams.set('effectiveDate', f.effectiveDate); url.searchParams.set('orderBy', 'xdate'); }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to fetch leads');

      const result = await res.json();
      if (result.success) {
        setAllLeads(result.data || []);
        if (result.counts) setCounts(result.counts);
      } else {
        throw new Error(result.error || 'Failed to fetch leads');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ERROR_MESSAGES.FETCH_LEADS_FAILED;
      setError(msg);
      setSnackbar({ open: true, message: msg, severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (newFilters: LeadFilters) => {
    // The engine toggle and the pipeline tabs both drive the server-side engine
    // filter; grade / status / size are the other server-side filters.
    const tab: TabValue =
      newFilters.engine === 1 ? 'engine1' :
      newFilters.engine === 2 ? 'engine2' : 'all';
    const f = { grade: newFilters.grade, status: newFilters.status, size: newFilters.size || 100, effectiveDate: newFilters.effectiveDate };
    setActiveTab(tab);
    setFilters(f);
    fetchLeads(tab, f);
  };

  // Tabs are server-driven so per-engine rows AND counts are always correct.
  const selectTab = (v: TabValue) => {
    setActiveTab(v);
    fetchLeads(v, filters);
  };
  const handleTabChange = (_e: React.SyntheticEvent, v: TabValue) => selectTab(v);

  // Load every lead in the current view (no practical cap).
  const loadAll = () => {
    const f = { ...filters, size: 100000 };
    setFilters(f);
    fetchLeads(activeTab, f);
  };

  const displayLeads = allLeads;
  const viewTotal =
    activeTab === 'engine1' ? counts.engine1 :
    activeTab === 'engine2' ? counts.engine2 :
    counts.total;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 'bold', mb: 0.5 }}>
          NJ Lead Pipeline
        </Typography>
        <Typography variant="body1" color="textSecondary">
          New Jersey homeowner insurance leads — enriched, graded, and carrier-checked
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <SearchForm onSearch={handleSearch} loading={loading} />

      {/* Pipeline selector — dropdown on mobile (<md) */}
      <FormControl size="small" fullWidth sx={{ display: { xs: 'flex', md: 'none' }, mb: 3 }}>
        <InputLabel id="pipeline-view-label">View</InputLabel>
        <Select
          labelId="pipeline-view-label"
          label="View"
          value={activeTab}
          onChange={(e) => selectTab(e.target.value as TabValue)}
        >
          <MenuItem value="all">All Leads ({counts.total})</MenuItem>
          <MenuItem value="engine1">Engine 1 — New Purchase ({counts.engine1})</MenuItem>
          <MenuItem value="engine2">Engine 2 — Renewal ({counts.engine2})</MenuItem>
        </Select>
      </FormControl>

      {/* Pipeline Tabs — desktop (md+) */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3, display: { xs: 'none', md: 'block' } }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label="pipeline tabs"
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          <Tab
            icon={<AllInboxIcon />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                All Leads
                <Chip label={counts.total} size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
              </Box>
            }
            value="all"
          />
          <Tab
            icon={<HomeWorkIcon />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Engine 1 — New Purchase
                <Chip
                  label={counts.engine1}
                  size="small"
                  sx={{ height: 18, fontSize: '0.7rem', backgroundColor: '#c8e6c9', color: '#1b5e20' }}
                />
              </Box>
            }
            value="engine1"
          />
          <Tab
            icon={<AutorenewIcon />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                Engine 2 — Renewal
                <Chip
                  label={counts.engine2}
                  size="small"
                  sx={{ height: 18, fontSize: '0.7rem', backgroundColor: '#fff3e0', color: '#e65100' }}
                />
              </Box>
            }
            value="engine2"
          />
        </Tabs>
      </Box>

      {/* Tab description */}
      {activeTab === 'engine1' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <strong>Engine 1 — New Purchase:</strong> Homeowners with a mortgage originated within the last 90 days. Highest priority — actively shopping for insurance.
        </Alert>
      )}
      {activeTab === 'engine2' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Engine 2 — Renewal / Win-Back:</strong> Mortgage originations from 2022–2025. Targeted ~60 days before their expected policy renewal date.
        </Alert>
      )}

      {/* Total in DB + load-all control */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Showing <strong>{displayLeads.length.toLocaleString()}</strong> of{' '}
          <strong>{viewTotal.toLocaleString()}</strong>{' '}
          {activeTab === 'engine1' ? 'New Purchase' : activeTab === 'engine2' ? 'Renewal' : ''} leads in database
        </Typography>
        {displayLeads.length < viewTotal && (
          <Button size="small" variant="outlined" onClick={loadAll} disabled={loading}>
            Load all {viewTotal.toLocaleString()}
          </Button>
        )}
      </Box>

      {loading && allLeads.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <LeadsTable
          leads={displayLeads}
          loading={loading}
          fetchSize={filters.size ?? 100}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
