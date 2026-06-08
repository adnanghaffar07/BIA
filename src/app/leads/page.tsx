'use client';

import React, { useEffect, useState } from 'react';
import {
  Container, Box, Alert, CircularProgress, Typography,
  Snackbar, Tabs, Tab, Chip,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  useEffect(() => {
    fetchLeads(filters);
  }, []);

  const fetchLeads = async (currentFilters: LeadFilters) => {
    try {
      setLoading(true);
      setError(null);

      const url = new URL('/api/leads', window.location.origin);
      url.searchParams.set('size', String(currentFilters.size || 20));
      if (currentFilters.engine) {
        url.searchParams.set('engine', String(currentFilters.engine));
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to fetch leads');

      const result = await res.json();
      if (result.success) {
        setAllLeads(result.data || []);
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
    setFilters(newFilters);
    fetchLeads(newFilters);
  };

  // Filter leads by pipeline engine for tabs
  const engine1Leads = allLeads.filter((l) => l.engine === 1);
  const engine2Leads = allLeads.filter((l) => l.engine === 2);

  const displayLeads =
    activeTab === 'engine1' ? engine1Leads :
    activeTab === 'engine2' ? engine2Leads :
    allLeads;

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

      {/* Pipeline Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)} aria-label="pipeline tabs">
          <Tab
            icon={<AllInboxIcon />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                All Leads
                <Chip label={allLeads.length} size="small" sx={{ height: 18, fontSize: '0.7rem' }} />
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
                  label={engine1Leads.length}
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
                  label={engine2Leads.length}
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
          <strong>Engine 2 — Renewal / Win-Back:</strong> Mortgage originations from 2022–2025. Targeted ~90 days before their expected policy renewal date.
        </Alert>
      )}

      {loading && allLeads.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <LeadsTable
          leads={displayLeads}
          loading={loading}
          fetchSize={filters.size ?? 20}
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
