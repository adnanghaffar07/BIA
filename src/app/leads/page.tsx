'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Container, Box, Alert, CircularProgress, Typography, Button,
  Snackbar, Tabs, Tab, Chip, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import SearchForm from '@/components/SearchForm';
import SkipTraceBlastDialog from '@/components/SkipTraceBlastDialog';
import { useAuth } from '@/context/AuthContext';
import LeadsTable from '@/components/LeadsTable';
import { LeadFilters } from '@/types/lead';
import { ERROR_MESSAGES, REAPI_TARGET_ZIPS } from '@/lib/constants';

type TabValue = 'all' | 'engine1' | 'engine2';

export default function LeadsPage() {
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [counts, setCounts] = useState<{ total: number; engine1: number; engine2: number }>({ total: 0, engine1: 0, engine2: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ grade?: string; status?: string; size: number; effectiveDate?: string; effectiveTo?: string; carrier?: string; propertyType?: string; county?: string; zip?: string; contact?: string }>({ size: 100 });
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const engineForTab = (t: TabValue): 1 | 2 | undefined => (t === 'engine1' ? 1 : t === 'engine2' ? 2 : undefined);
  const [restoreKey, setRestoreKey] = useState(0);
  const [blastOpen, setBlastOpen] = useState(false);
  const { user } = useAuth();
  // Stale-response guard: a broad fetch (e.g. "All" rows) can outlive a newer, narrower one
  // and overwrite it. Only the newest request writes state (Frank Aug-2026).
  const reqSeq = useRef(0);

  // Restore the last-used filters so the Back button returns to the same filtered
  // list (Frank Jun-2026), then keep them persisted across the detail-page round-trip.
  useEffect(() => {
    let saved: any = null;
    try { saved = JSON.parse(sessionStorage.getItem('biaLeadsView') || 'null'); } catch { /* ignore */ }
    if (saved?.filters) {
      setFilters(saved.filters);
      setActiveTab(saved.activeTab || 'all');
      setRestoreKey(1); // remount SearchForm once so its dropdowns reflect the restored filters
      fetchLeads(saved.activeTab || 'all', saved.filters);
    } else {
      fetchLeads('all', { size: 100 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem('biaLeadsView', JSON.stringify({ filters, activeTab })); } catch { /* ignore */ }
  }, [filters, activeTab]);

  const fetchLeads = async (tab: TabValue, f: { grade?: string; status?: string; size: number; effectiveDate?: string; effectiveTo?: string; carrier?: string; propertyType?: string; county?: string; zip?: string; contact?: string }) => {
    const seq = ++reqSeq.current;
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
      if (f.carrier) url.searchParams.set('carrier', f.carrier);
      if (f.propertyType) url.searchParams.set('propertyType', f.propertyType);
      // County/ZIP are server-side (Frank Aug-2026) so their counts describe the whole
      // book rather than whichever rows this page happened to load.
      if (f.county) url.searchParams.set('county', f.county);
      if (f.zip) url.searchParams.set('zip', f.zip);
      // Contact availability — leads only have an email or phone once a skip trace
      // has run, so this is what makes an export usable for outreach.
      if (f.contact) url.searchParams.set('contact', f.contact);
      if (f.effectiveDate) { url.searchParams.set('effectiveDate', f.effectiveDate); url.searchParams.set('orderBy', 'xdate'); }
      if (f.effectiveTo) url.searchParams.set('effectiveTo', f.effectiveTo);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to fetch leads');

      const result = await res.json();
      if (seq !== reqSeq.current) return; // superseded by a newer filter change
      if (result.success) {
        setAllLeads(result.data || []);
        if (result.counts) setCounts(result.counts);
      } else {
        throw new Error(result.error || 'Failed to fetch leads');
      }
    } catch (err) {
      if (seq !== reqSeq.current) return;
      const msg = err instanceof Error ? err.message : ERROR_MESSAGES.FETCH_LEADS_FAILED;
      setError(msg);
      setSnackbar({ open: true, message: msg, severity: 'error' });
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const handleSearch = (newFilters: LeadFilters) => {
    // The engine toggle and the pipeline tabs both drive the server-side engine
    // filter; grade / status / size are the other server-side filters.
    const tab: TabValue =
      newFilters.engine === 1 ? 'engine1' :
      newFilters.engine === 2 ? 'engine2' : 'all';
    // Page size is no longer a form field — preserve the current size (100 default,
    // or "all" if the user picked All in the pagination) across filter changes.
    const f = { grade: newFilters.grade, status: newFilters.status, size: filters.size ?? 100, effectiveDate: newFilters.effectiveDate, effectiveTo: newFilters.effectiveTo, carrier: newFilters.carrier, propertyType: filters.propertyType, county: filters.county, zip: filters.zip, contact: filters.contact };
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

  // Deep Skip Trace Blast (Frank Sep-2026). Deliberately narrow: it appears only
  // when the view is already scoped to Grade A over a from/to effective-date range,
  // because those two filters are what make the cohort small and intentional enough
  // to spend credits on. Admin-only for the same reason.
  const canBlast =
    (user?.role === 'admin' || user?.role === 'superadmin') &&
    filters.grade === 'A' && !!filters.effectiveDate && !!filters.effectiveTo;

  /**
   * Everything matching the CURRENTLY APPLIED filters, straight from the server.
   *
   * Export uses this rather than the rows on screen, for two reasons that both bit us:
   * the table holds only the first page, so an export silently covered 100 of 585; and
   * the rows are as old as the last fetch, so a skip trace run since page load would
   * be missing from the file. This always reflects the database now.
   */
  const fetchAllForExport = async (): Promise<any[]> => {
    const url = new URL('/api/leads', window.location.origin);
    url.searchParams.set('source', 'db');
    url.searchParams.set('size', '100000');
    const engine = engineForTab(activeTab);
    if (engine) url.searchParams.set('engine', String(engine));
    if (filters.grade) url.searchParams.set('grade', filters.grade);
    if (filters.status) url.searchParams.set('status', filters.status);
    if (filters.carrier) url.searchParams.set('carrier', filters.carrier);
    if (filters.propertyType) url.searchParams.set('propertyType', filters.propertyType);
    if (filters.county) url.searchParams.set('county', filters.county);
    if (filters.zip) url.searchParams.set('zip', filters.zip);
    if (filters.contact) url.searchParams.set('contact', filters.contact);
    if (filters.effectiveDate) { url.searchParams.set('effectiveDate', filters.effectiveDate); url.searchParams.set('orderBy', 'xdate'); }
    if (filters.effectiveTo) url.searchParams.set('effectiveTo', filters.effectiveTo);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Could not load the leads for export');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Could not load the leads for export');
    return json.data ?? [];
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

      <SearchForm
        key={restoreKey}
        onSearch={handleSearch}
        loading={loading}
        initial={restoreKey ? { ...filters, engine: engineForTab(activeTab) } : undefined}
      />

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
        {/* Frank Aug-2026: this used to always read "Showing 728 of 728 leads in database",
            which sat next to "Rows per page: 100" and looked like the page size had been
            ignored. The two numbers answer different questions — how many are loaded vs how
            many are on screen — so once everything is loaded we stop repeating the count. */}
        <Typography variant="body2" color="text.secondary">
          {displayLeads.length < viewTotal ? (
            <>
              Loaded <strong>{displayLeads.length.toLocaleString()}</strong> of{' '}
              <strong>{viewTotal.toLocaleString()}</strong>{' '}
              {activeTab === 'engine1' ? 'New Purchase' : activeTab === 'engine2' ? 'Renewal' : ''} leads matching these filters
            </>
          ) : (
            <>
              <strong>{viewTotal.toLocaleString()}</strong>{' '}
              {activeTab === 'engine1' ? 'New Purchase' : activeTab === 'engine2' ? 'Renewal' : ''} leads match these filters —
              {' '}use the pager below to page through them
            </>
          )}
        </Typography>
        {/* One-click load-all (Frank Aug-2026). This used to be a line of text telling
            the user to go find the rows-per-page menu in the table footer — easy to miss,
            and it read as "the page won't show me past 100". */}
        {displayLeads.length < viewTotal && (
          <Button
            size="small"
            variant="outlined"
            onClick={loadAll}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={13} color="inherit" /> : undefined}
          >
            {loading ? 'Loading…' : `Load all ${viewTotal.toLocaleString()}`}
          </Button>
        )}
        {canBlast && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<PersonSearchIcon />}
            onClick={() => setBlastOpen(true)}
            disabled={loading}
          >
            Deep Skip Trace Blast
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
          resetKey={activeTab}
          totalAvailable={viewTotal}
          fetchAllForExport={fetchAllForExport}
          onRowsPerPageChange={(rpp) => {
            // -1 is "All". Any size larger than the rows currently loaded also needs a
            // server fetch, otherwise the footer says 250/page while only 100 exist.
            if (rpp === -1 || rpp > allLeads.length) loadAll();
          }}
          serverFilters={{
            county: filters.county ?? '',
            zip: filters.zip ?? '',
            propertyType: filters.propertyType ?? '',
            contact: filters.contact ?? '',
            zipOptions: [...REAPI_TARGET_ZIPS].sort(),
            onChange: (next) => {
              const f = { ...filters, ...next };
              setFilters(f);
              fetchLeads(activeTab, f);
            },
          }}
        />
      )}

      {/* Mounted only while open so each run starts from clean state. */}
      {blastOpen && (
      <SkipTraceBlastDialog
        open
        onClose={() => setBlastOpen(false)}
        filters={{
          grade: filters.grade,
          status: filters.status,
          carrier: filters.carrier,
          propertyType: filters.propertyType,
          county: filters.county,
          zip: filters.zip,
          engine: engineForTab(activeTab) ?? undefined,
          effectiveDate: filters.effectiveDate,
          effectiveTo: filters.effectiveTo,
        }}
        onFinished={(t) => {
          setSnackbar({
            open: true,
            message: `Traced ${t.processed} lead${t.processed === 1 ? '' : 's'} — ${t.hit} matched, ${t.creditsSpent} credits. Recovered ${t.phone} phone, ${t.email} email.`,
            severity: 'success',
          });
          fetchLeads(activeTab, filters);
        }}
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
