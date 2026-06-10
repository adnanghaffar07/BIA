'use client';

import React, { useState, Fragment, useEffect, useMemo } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Box, TablePagination, CircularProgress,
  Typography, Button, Stack, Collapse, Chip, Menu, MenuItem, ListItemIcon, ListItemText,
  TextField, Select, FormControl, InputLabel, InputAdornment,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import GetAppIcon from '@mui/icons-material/GetApp';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useRouter } from 'next/navigation';
import { Lead } from '@/types/lead';
import { LeadGrade } from '@/types/grade';
import { formatCurrency } from '@/utils/formatAddress';
import { exportLeadsToCSV } from '@/utils/csvExport';
import PropertyDetailsContent from '@/components/PropertyDetailsContent';
import LeadGradeBadge from '@/components/LeadGradeBadge';
import CarrierEligibilityBadge from '@/components/CarrierEligibilityBadge';

interface LeadsTableProps {
  leads: any[]; // accepts both Lead and DB lead shapes
  loading?: boolean;
  fetchSize?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (rowsPerPage: number) => void;
}

function getLeadRowKey(lead: any, index: number): string {
  return lead.propertyId || lead.id || `lead-row-${index}`;
}

const COLUMN_COUNT = 12;
const EXPANDED_ROW_BG = '#e3edf7';
const EXPANDED_ROW_HEADER_BG = '#d4e4f5';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; rowBg: string }> = {
  new:         { label: 'New',        color: '#1565c0', bg: '#e3f2fd', rowBg: 'transparent' },
  contacted:   { label: 'Contacted',  color: '#e65100', bg: '#fff3e0', rowBg: '#fffde7' },
  qualified:   { label: 'Qualified',  color: '#1b5e20', bg: '#e8f5e9', rowBg: '#f1f8e9' },
  quote_sent:  { label: 'Quote Sent', color: '#4a148c', bg: '#f3e5f5', rowBg: '#fce4ec' },
  bound:       { label: 'Bound',      color: '#fff',    bg: '#2e7d32', rowBg: '#e8f5e9' },
  lost:        { label: 'Lost',       color: '#fff',    bg: '#c62828', rowBg: '#ffebee' },
};

function StatusChip({ status }: { status?: string }) {
  const cfg = STATUS_CONFIG[status ?? 'new'] ?? STATUS_CONFIG.new;
  return (
    <Chip
      label={cfg.label}
      size="small"
      sx={{
        fontWeight: 700,
        fontSize: '0.68rem',
        height: 20,
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: 'none',
      }}
    />
  );
}

function getOwnerDisplayName(lead: any): string {
  if (lead.companyName) return lead.companyName;
  const first = lead.owner1FirstName || '';
  const last = lead.owner1LastName || '';
  if (first || last) return `${first} ${last}`.trim();
  return '—';
}

function getAddress(lead: any) {
  // Supports both raw API shape (lead.address.street) and DB shape (lead.addressStreet)
  return {
    street: lead.address?.street || lead.addressStreet || '—',
    city: lead.address?.city || lead.addressCity || '—',
    state: lead.address?.state || lead.addressState || 'NJ',
    zip: lead.address?.zip || lead.addressZip || '',
  };
}

function EngineChip({ engine }: { engine: number | null | undefined }) {
  if (!engine) return <Typography variant="caption" color="textSecondary">—</Typography>;
  return (
    <Chip
      icon={engine === 1 ? <HomeWorkIcon sx={{ fontSize: '0.8rem !important' }} /> : <AutorenewIcon sx={{ fontSize: '0.8rem !important' }} />}
      label={engine === 1 ? 'New Purchase' : 'Renewal'}
      size="small"
      sx={{
        backgroundColor: engine === 1 ? '#e8f5e9' : '#fff3e0',
        color: engine === 1 ? '#2e7d32' : '#e65100',
        border: `1px solid ${engine === 1 ? '#a5d6a7' : '#ffcc80'}`,
        fontSize: '0.7rem',
        height: 22,
        '& .MuiChip-icon': { color: engine === 1 ? '#2e7d32' : '#e65100' },
      }}
    />
  );
}

function LeadRow({ lead }: { lead: any }) {
  const [open, setOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const router = useRouter();
  const addr = getAddress(lead);
  const grade = lead.grade as LeadGrade | null;
  const status = lead.status ?? 'new';
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.new;
  const isTouched = status !== 'new';

  // Stale: Grade A, never contacted, sitting in queue > 14 days
  const isStale = (() => {
    if (grade !== 'A' || status !== 'new' || lead.firstRpcAt) return false;
    if (!lead.queueEnteredAt) return false;
    const daysInQueue = (Date.now() - new Date(lead.queueEnteredAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysInQueue > 14;
  })();

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => setMenuAnchor(null);

  const xDate = lead.renewalTargetDate
    ? new Date(lead.renewalTargetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    : null;

  const xDateUrgent = lead.renewalTargetDate
    ? (new Date(lead.renewalTargetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 30
    : false;

  return (
    <Fragment>
      <TableRow
        hover
        onClick={() => setOpen((p) => !p)}
        sx={{
          cursor: 'pointer',
          backgroundColor: open
            ? EXPANDED_ROW_HEADER_BG
            : isStale ? '#fff8e1'
            : isTouched ? statusCfg.rowBg : 'background.paper',
          '& > td': { borderBottom: open ? 'none' : undefined, backgroundColor: 'inherit' },
          // Left border: stale = amber, touched = status color
          '& > td:first-of-type': {
            ...((isStale || isTouched) && !open ? {
              borderLeft: `3px solid ${isStale ? '#f59e0b' : (statusCfg.bg === '#fff' ? statusCfg.color : statusCfg.bg)}`,
            } : {}),
          },
        }}
      >
        {/* Expand toggle */}
        <TableCell padding="checkbox" sx={{ width: 40 }}>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>

        {/* Status — show stale badge if applicable */}
        <TableCell sx={{ width: 130 }}>
          <Stack spacing={0.5}>
            <StatusChip status={status} />
            {isStale && (
              <Chip
                label="Stale >14d"
                size="small"
                icon={<WarningAmberIcon style={{ fontSize: 12 }} />}
                sx={{ fontSize: 10, height: 18, bgcolor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', '& .MuiChip-icon': { color: '#f59e0b' } }}
              />
            )}
          </Stack>
        </TableCell>

        {/* Grade */}
        <TableCell sx={{ width: 60 }}>
          {grade ? (
            <LeadGradeBadge grade={grade} size="small" showLabel={false} />
          ) : (
            <Typography variant="caption" color="textSecondary">—</Typography>
          )}
        </TableCell>

        {/* Owner */}
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{getOwnerDisplayName(lead)}</Typography>
        </TableCell>

        {/* Address */}
        <TableCell>
          <Stack spacing={0}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{addr.street}</Typography>
            <Typography variant="caption" color="textSecondary">{addr.zip}</Typography>
          </Stack>
        </TableCell>

        {/* City/State */}
        <TableCell>{addr.city}, {addr.state}</TableCell>

        {/* X-date */}
        <TableCell align="center">
          {xDate ? (
            <Typography
              variant="caption"
              sx={{ fontWeight: xDateUrgent ? 700 : 400, color: xDateUrgent ? '#c62828' : 'text.secondary' }}
            >
              {xDate}
              {xDateUrgent && ' ⚠'}
            </Typography>
          ) : (
            <Typography variant="caption" color="textSecondary">—</Typography>
          )}
        </TableCell>

        {/* Engine */}
        <TableCell><EngineChip engine={lead.engine} /></TableCell>

        {/* Carriers */}
        <TableCell>
          <CarrierEligibilityBadge
            travelersEligible={lead.travelersEligible}
            travelersNotes={lead.travelersNotes}
            plymouthEligible={lead.plymouthEligible}
            plymouthNotes={lead.plymouthNotes}
          />
        </TableCell>

        {/* Indicative Premium */}
        <TableCell align="right">
          {lead.expectedPremium ? (
            <Stack sx={{ alignItems: 'flex-end' }} spacing={0}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#1b5e20' }}>
                {formatCurrency(lead.expectedPremium)}/yr
              </Typography>
              <Typography variant="caption" color="textSecondary">
                {lead.lowPremium ? `${formatCurrency(lead.lowPremium)} – ${formatCurrency(lead.highPremium)}` : ''}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="caption" color="textSecondary">—</Typography>
          )}
        </TableCell>

        {/* Est. Value */}
        <TableCell align="right">
          {(lead.estimatedValue || lead.address?.estimatedValue)
            ? formatCurrency(lead.estimatedValue)
            : '-'}
        </TableCell>

        {/* Sq Ft */}
        <TableCell align="right">
          {lead.squareFeet ? lead.squareFeet.toLocaleString() : '-'}
        </TableCell>

        {/* ⋮ Actions menu */}
        <TableCell padding="checkbox" sx={{ width: 40 }} onClick={(e) => e.stopPropagation()}>
          <IconButton size="small" onClick={openMenu}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={closeMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { elevation: 3, sx: { minWidth: 220 } } }}
          >
            <MenuItem
              onClick={() => {
                closeMenu();
                router.push(`/leads/${lead.propertyId || lead.id}`);
              }}
            >
              <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Full Detail / Producer View" />
            </MenuItem>
          </Menu>
        </TableCell>
      </TableRow>

      {/* Expanded detail row */}
      <TableRow sx={{ backgroundColor: open ? EXPANDED_ROW_BG : 'inherit' }}>
        <TableCell
          colSpan={COLUMN_COUNT}
          sx={{ py: 0, px: 0, borderBottom: open ? undefined : 'none', backgroundColor: open ? EXPANDED_ROW_BG : 'inherit' }}
        >
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ px: 3, pb: 3, pt: 1.5, backgroundColor: EXPANDED_ROW_BG, borderTop: '1px solid', borderColor: '#b6cce8' }}>
              <PropertyDetailsContent property={lead} />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  );
}

export default function LeadsTable({
  leads,
  loading = false,
  fetchSize = 20,
  onPageChange,
  onRowsPerPageChange,
}: LeadsTableProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(fetchSize);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [search, setSearch]         = useState('');
  const [filterZip, setFilterZip]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Derive unique ZIPs from current leads for the ZIP dropdown
  const availableZips = useMemo(() => {
    const zips = new Set<string>();
    leads.forEach((l) => {
      const zip = l.addressZip || l.address?.zip;
      if (zip) zips.add(zip);
    });
    return Array.from(zips).sort();
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const addr = getAddress(l);
      const owner = getOwnerDisplayName(l).toLowerCase();
      const street = (addr.street || '').toLowerCase();
      const zip = addr.zip || '';

      if (q && !street.includes(q) && !owner.includes(q) && !zip.includes(q)) return false;
      if (filterZip && zip !== filterZip) return false;
      if (filterStatus && (l.status ?? 'new') !== filterStatus) return false;
      return true;
    });
  }, [leads, search, filterZip, filterStatus]);

  const hasFilters = search || filterZip || filterStatus;

  const clearFilters = () => {
    setSearch('');
    setFilterZip('');
    setFilterStatus('');
  };

  const totalRows = filteredLeads.length;
  const maxPage = useMemo(() => Math.max(0, Math.ceil(totalRows / rowsPerPage) - 1), [totalRows, rowsPerPage]);
  const safePage = Math.min(page, maxPage);

  useEffect(() => { setPage(0); }, [leads, search, filterZip, filterStatus]);
  useEffect(() => { if (fetchSize > 0) { setRowsPerPage(fetchSize); setPage(0); } }, [fetchSize]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);

  const paginatedLeads = filteredLeads.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
  const rangeStart = totalRows === 0 ? 0 : safePage * rowsPerPage + 1;
  const rangeEnd = Math.min((safePage + 1) * rowsPerPage, totalRows);

  if (loading && leads.length === 0) {
    return <Paper sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Paper>;
  }

  if (leads.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="textSecondary" sx={{ mb: 1 }}>No leads found</Typography>
        <Typography variant="body2" color="textSecondary">Try adjusting your filters or fetching more records</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search address or owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ flex: 2, minWidth: 200 }}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              },
            }}
          />
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>ZIP</InputLabel>
            <Select value={filterZip} label="ZIP" onChange={(e) => setFilterZip(e.target.value)}>
              <MenuItem value="">All ZIPs</MenuItem>
              {availableZips.map((z) => <MenuItem key={z} value={z}>{z}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Status</InputLabel>
            <Select value={filterStatus} label="Status" onChange={(e) => setFilterStatus(e.target.value)}>
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="new">New</MenuItem>
              <MenuItem value="contacted">Contacted</MenuItem>
              <MenuItem value="qualified">Qualified</MenuItem>
              <MenuItem value="quote_sent">Quote Sent</MenuItem>
              <MenuItem value="bound">Bound</MenuItem>
              <MenuItem value="lost">Lost</MenuItem>
            </Select>
          </FormControl>
          {hasFilters && (
            <Button size="small" startIcon={<ClearIcon />} onClick={clearFilters} color="inherit">
              Clear
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" startIcon={<GetAppIcon />} onClick={() => exportLeadsToCSV(filteredLeads)} size="small">
            Export CSV
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">
          {hasFilters
            ? <>{totalRows.toLocaleString()} <Typography component="span" variant="body2" color="text.secondary">of {leads.length.toLocaleString()} leads</Typography></>
            : <>{totalRows.toLocaleString()} Leads</>
          }
          {loading && totalRows > 0 && <CircularProgress size={16} sx={{ ml: 1.5, verticalAlign: 'middle' }} />}
        </Typography>
        <Typography variant="body2" color="textSecondary">Click any row to expand details</Typography>
      </Box>

      <TableContainer component={Paper}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }} />
              <TableCell sx={{ fontWeight: 'bold', minWidth: 110 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 60 }}>Grade</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }}>Owner</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 160 }}>Address</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 120 }}>City / State</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 90 }} align="center">X-Date</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 120 }}>Pipeline</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 120 }}>Carriers</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }} align="right">Est. Premium</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 110 }} align="right">Est. Value</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 80 }} align="right">Sq Ft</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedLeads.map((lead, index) => (
              <LeadRow key={getLeadRowKey(lead, safePage * rowsPerPage + index)} lead={lead} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        rowsPerPageOptions={[10, 20, 25, 50, 100]}
        component="div"
        count={totalRows}
        rowsPerPage={rowsPerPage}
        page={safePage}
        onPageChange={(_e, p) => { setPage(p); onPageChange?.(p); }}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); onRowsPerPageChange?.(parseInt(e.target.value, 10)); }}
        labelDisplayedRows={() => `${rangeStart}–${rangeEnd} of ${totalRows}`}
        showFirstButton
        showLastButton
      />
    </Box>
  );
}
