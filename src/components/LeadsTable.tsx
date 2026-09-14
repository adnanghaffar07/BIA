'use client';

import React, { useState, Fragment, useEffect, useMemo } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Box, TablePagination, CircularProgress,
  Typography, Button, Stack, Collapse, Chip, Menu, MenuItem, ListItemIcon, ListItemText,
  TextField, Select, FormControl, InputLabel, InputAdornment, Tooltip,
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
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { useRouter, usePathname } from 'next/navigation';
import { Lead } from '@/types/lead';
import { LeadGrade } from '@/types/grade';
import { countyForZip, COUNTY_FILTER_OPTIONS } from '@/lib/constants';
import { useStickyState } from '@/hooks/useStickyState';
import { formatCurrency } from '@/utils/formatAddress';
import { exportLeadsToCSV } from '@/utils/csvExport';
import PropertyDetailsContent from '@/components/PropertyDetailsContent';
import LeadGradeBadge from '@/components/LeadGradeBadge';
import CarrierEligibilityBadge from '@/components/CarrierEligibilityBadge';

interface LeadsTableProps {
  leads: any[]; // accepts both Lead and DB lead shapes
  loading?: boolean;
  fetchSize?: number;
  /**
   * Total rows available on the SERVER for the current filters, when that is larger
   * than what has been loaded. The page-size ladder is built from this so a size big
   * enough to trigger a full load stays offerable — capping the ladder at the loaded
   * count would make "load more" unreachable. Omit when everything is already loaded.
   */
  totalAvailable?: number;
  /** When this changes (e.g. the active tab), pagination resets to page 1 @ 25/page. */
  resetKey?: string | number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (rowsPerPage: number) => void;
  /**
   * Page-specific controls rendered inside this filter bar, before Search/ZIP/Status,
   * so a page never grows a second row of filters somewhere else (Frank Jul-2026 —
   * the Queue's date/carrier controls belong here, not in the page header).
   */
  extraFilters?: React.ReactNode;
  /**
   * Drive County/ZIP from the SERVER instead of filtering the loaded rows (Frank Aug-2026).
   * Without this the two selects only ever saw the rows already fetched — at the default
   * page size of 100 a county count silently described a 100-row sample. Pages that pass
   * this own the values and refetch on change; pages that don't keep the old local
   * behaviour, which is still correct for a fully-loaded list (the Queue).
   */
  /**
   * Fetch the COMPLETE, CURRENT set for the applied filters, for export.
   *
   * Without this, Export writes whatever rows the browser happens to be holding —
   * which is the first page only, and is as stale as the last fetch. A skip trace
   * that ran since the page loaded would be missing from the file, and a filter
   * typed but not applied would silently export the previous cohort.
   */
  fetchAllForExport?: () => Promise<any[]>;
  serverFilters?: {
    county: string;
    zip: string;
    propertyType: string;
    contact: string;
    zipOptions: string[];
    onChange: (next: { county?: string; zip?: string; propertyType?: string; contact?: string }) => void;
  };
}

/**
 * Contact availability. Worth its own control because contact details only appear
 * once a skip trace has run — an unfiltered export is mostly blank contact columns,
 * which looks like a broken file rather than like leads nobody has worked.
 * "Has email" includes the co-insured address: the household is reachable either way.
 */
const CONTACT_OPTIONS = [
  { value: '', label: 'Any contact status' },
  { value: 'email', label: 'Has email' },
  { value: 'phone', label: 'Has phone' },
  { value: 'either', label: 'Has email or phone' },
  { value: 'none', label: 'No contact yet' },
];

/** Mirror of the server-side contact predicate, for fully-loaded lists (the Queue). */
function matchesContact(lead: any, want: string): boolean {
  if (!want) return true;
  const has = (v: unknown) => !!String(v ?? '').trim();
  // The co-insured counts: the household is reachable either way.
  const email = has(lead?.email1) || has(lead?.owner2Email);
  const phone = has(lead?.phone1) || has(lead?.owner2Phone);
  switch (want) {
    case 'email':  return email;
    case 'phone':  return phone;
    case 'either': return email || phone;
    case 'none':   return !email && !phone;
    default:       return true;
  }
}

function getLeadRowKey(lead: any, index: number): string {
  return lead.propertyId || lead.id || `lead-row-${index}`;
}

// Dwelling type (Frank Aug-2026). Condos are underwritten very differently — they are
// exempt from the roof-age gate, so they grade A far more often than single-family. Being
// able to split the book by this on BOTH the Leads page and the Queue matters for working
// the right slate. propertyType is the reliable field: every condo-ish landUse value
// ('Condominium', 'Townhouse/Condo') already carries CONDO there, and no SFR does.
export const DWELLING_TYPE_OPTIONS = [
  { value: '', label: 'All Property Types' },
  { value: 'SFR', label: 'Single Family (SFH)' },
  { value: 'CONDO', label: 'Condo' },
];

/** Does this lead match the chosen dwelling type? Mirrors the QC report's condo rule. */
function matchesDwellingType(lead: { propertyType?: string | null; landUse?: string | null }, want: string): boolean {
  if (!want) return true;
  const t = String(lead.propertyType ?? '').toUpperCase();
  const isCondo = t === 'CONDO' || /condo/i.test(lead.landUse ?? '');
  return want === 'CONDO' ? isCondo : t === want && !isCondo;
}

const COLUMN_COUNT = 12;
const EXPANDED_ROW_BG = '#e3edf7';
const EXPANDED_ROW_HEADER_BG = '#d4e4f5';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; rowBg: string }> = {
  new:             { label: 'New',             color: '#1565c0', bg: '#e3f2fd', rowBg: 'transparent' },
  rated:           { label: 'Rated',           color: '#4a148c', bg: '#f3e5f5', rowBg: '#faf4fc' },
  referral:        { label: 'Referral',        color: '#8a5a00', bg: '#fff3d6', rowBg: '#fffcf2' },
  indicative_sent: { label: 'Indicative Sent', color: '#e65100', bg: '#fff3e0', rowBg: '#fffde7' },
  pos_ran:         { label: 'POS Ran',         color: '#00695c', bg: '#e0f2f1', rowBg: '#eff8f7' },
  quote_issued:    { label: 'Quote Issued',    color: '#1b5e20', bg: '#e8f5e9', rowBg: '#f1f8e9' },
  bound:           { label: 'Bound',           color: '#fff',    bg: '#2e7d32', rowBg: '#e8f5e9' },
  lost:            { label: 'Lost',            color: '#fff',    bg: '#c62828', rowBg: '#ffebee' },
  // Parked by the appetite rules — greyed out so it reads as "not workable", not "failed".
  quarantine:      { label: 'Quarantine',      color: '#455a64', bg: '#eceff1', rowBg: '#f7f9fa' },
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

  // Triage date (Frank Phase 5): effective date covers both engines
  // (new purchase = origination + 90d; renewal = x-date). Falls back to x-date.
  const triageDate = lead.effectiveDate || lead.renewalTargetDate;
  const xDate = triageDate
    ? new Date(triageDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
    : null;

  const daysUntil = triageDate
    ? Math.round((new Date(triageDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const xDateUrgent = daysUntil != null && daysUntil <= 30;

  // Expiration = effective + 1 year (standard annual policy term). Frank Jul-2026 —
  // show the policy's expiry alongside its effective date. Derived, not stored.
  const expDate = (() => {
    if (!triageDate) return null;
    const d = new Date(triageDate);
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + 1);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  })();

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

        {/* Owner + skip-trace badge (Frank Aug-2026). Deep trace is the only tier, so
            deepSkipTracedAt is the marker. Colour carries the useful half: green =
            traced AND we got a contact; grey = traced and Tracerfy had nothing, which
            is a dead end rather than something still to do. No badge = never traced. */}
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{getOwnerDisplayName(lead)}</Typography>
          {lead.deepSkipTracedAt && (() => {
            const hasContact = !!(String(lead.phone1 ?? '').trim() || String(lead.phone2 ?? '').trim()
              || String(lead.email1 ?? '').trim() || String(lead.email2 ?? '').trim());
            const on = new Date(lead.deepSkipTracedAt).toLocaleDateString();
            return (
              <Tooltip title={hasContact ? `Deep skip traced ${on} — contact found` : `Deep skip traced ${on} — no contact returned`}>
                <Chip
                  size="small"
                  icon={<PersonSearchIcon sx={{ fontSize: 12 }} />}
                  label={hasContact ? 'Traced' : 'Traced · none'}
                  sx={{
                    mt: 0.4, height: 18, fontSize: 10, fontWeight: 600,
                    '& .MuiChip-icon': { ml: '4px', mr: '-2px' },
                    color: hasContact ? '#166534' : '#6b7280',
                    bgcolor: hasContact ? '#dcfce7' : '#f3f4f6',
                    border: `1px solid ${hasContact ? '#86efac' : '#d1d5db'}`,
                  }}
                />
              </Tooltip>
            );
          })()}
        </TableCell>

        {/* Address + property type (SFH / Condo) — Frank Oct-2026: visible on the row ribbon */}
        <TableCell>
          <Stack spacing={0.25}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{addr.street}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" color="textSecondary">{addr.zip}</Typography>
              {(() => {
                const t = String(lead.propertyType ?? '').toUpperCase();
                const isCondo = t === 'CONDO' || /condo/i.test(lead.landUse ?? '');
                const label = isCondo ? 'Condo' : t === 'SFR' ? 'SFH' : (lead.propertyType || '—');
                return (
                  <Chip
                    label={label}
                    size="small"
                    sx={{
                      height: 17, fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                      color: isCondo ? '#5b21b6' : '#166534',
                      bgcolor: isCondo ? '#ede9fe' : '#dcfce7',
                      border: `1px solid ${isCondo ? '#c4b5fd' : '#86efac'}`,
                    }}
                  />
                );
              })()}
            </Stack>
          </Stack>
        </TableCell>

        {/* City/State */}
        <TableCell>{addr.city}, {addr.state}</TableCell>

        {/* X-date */}
        <TableCell align="center">
          {xDate ? (
            <Stack spacing={0}>
              <Typography
                variant="caption"
                sx={{ fontWeight: xDateUrgent ? 700 : 400, color: xDateUrgent ? '#c62828' : 'text.secondary' }}
              >
                {xDate}
                {xDateUrgent && ' ⚠'}
              </Typography>
              {daysUntil != null && (
                <Typography variant="caption" sx={{ fontSize: '0.62rem', lineHeight: 1.1, color: daysUntil < 0 ? '#c62828' : 'text.disabled' }}>
                  {daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : `in ${daysUntil}d`}
                </Typography>
              )}
              {expDate && (
                <Typography variant="caption" sx={{ fontSize: '0.62rem', lineHeight: 1.1, color: 'text.disabled' }}>
                  exp {expDate}
                </Typography>
              )}
            </Stack>
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
  resetKey,
  onPageChange,
  onRowsPerPageChange,
  extraFilters,
  fetchAllForExport,
  serverFilters,
  totalAvailable,
}: LeadsTableProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(25);

  // ── Filter state ────────────────────────────────────────────────────────────
  // Filters persist across navigation (to a lead and back) until cleared — keyed per page
  // so /leads and /queue keep their own (Frank Aug-2026).
  const pathname = usePathname();
  const [search, setSearch]             = useStickyState(`lt:${pathname}:search`, '');
  const [filterZip, setFilterZip]       = useStickyState(`lt:${pathname}:zip`, '');
  const [filterStatus, setFilterStatus] = useStickyState(`lt:${pathname}:status`, '');
  const [filterCounty, setFilterCounty] = useStickyState(`lt:${pathname}:county`, ''); // Monmouth | Middlesex | Ocean
  const [filterType, setFilterType] = useStickyState(`lt:${pathname}:ptype`, ''); // SFR | CONDO

  // When the page filters server-side its values win and the local state is bypassed.
  const isServer = !!serverFilters;
  const [filterContact, setFilterContact] = useStickyState(`lt:${pathname}:contact`, '');
  const [exporting, setExporting] = useState(false);

  /**
   * Always export fresh. When the page can refetch, pull the whole filtered set from
   * the server first; otherwise fall back to the rows already loaded (the Queue holds
   * all of them, so that is complete too).
   */
  const handleExport = async () => {
    if (!fetchAllForExport) { exportLeadsToCSV(filteredLeads); return; }
    setExporting(true);
    try {
      const fresh = await fetchAllForExport();
      exportLeadsToCSV(fresh as any);
    } catch {
      // Never silently export stale rows in place of the real answer.
      alert('Could not refresh the leads for export. Nothing was downloaded — try again.');
    } finally {
      setExporting(false);
    }
  };

  const contactValue = serverFilters ? serverFilters.contact : filterContact;
  const setContactValue = (v: string) =>
    (serverFilters ? serverFilters.onChange({ contact: v }) : setFilterContact(v));
  const countyValue = serverFilters ? serverFilters.county : filterCounty;
  const zipValue = serverFilters ? serverFilters.zip : filterZip;
  const setCountyValue = (v: string) => (serverFilters ? serverFilters.onChange({ county: v }) : setFilterCounty(v));
  const setZipValue = (v: string) => (serverFilters ? serverFilters.onChange({ zip: v }) : setFilterZip(v));
  const typeValue = serverFilters ? serverFilters.propertyType : filterType;
  const setTypeValue = (v: string) => (serverFilters ? serverFilters.onChange({ propertyType: v }) : setFilterType(v));

  // Derive unique ZIPs from current leads for the ZIP dropdown
  const availableZips = useMemo(() => {
    const zips = new Set<string>();
    leads.forEach((l) => {
      const zip = l.addressZip || l.address?.zip;
      if (zip) zips.add(zip);
    });
    return Array.from(zips).sort();
  }, [leads]);
  // Server-side ZIP options come from the whole target list, not just the loaded rows.
  const zipChoices = serverFilters ? serverFilters.zipOptions : availableZips;

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      const addr = getAddress(l);
      const owner = getOwnerDisplayName(l).toLowerCase();
      const street = (addr.street || '').toLowerCase();
      const zip = addr.zip || '';

      if (q && !street.includes(q) && !owner.includes(q) && !zip.includes(q)) return false;
      if (!isServer && filterZip && zip !== filterZip) return false;
      if (!isServer && filterCounty) {
        // Prefer the county REAPI actually returned; the ZIP map is only a fallback,
        // because ZIPs straddle county lines (08812, 08512). Same rule the server-side
        // filter uses, so the Queue and the Leads page agree (Frank Aug-2026).
        const ac = String(l.addressCounty ?? '').trim();
        const bare = ac.toLowerCase().endsWith(' county') ? ac.slice(0, -' county'.length).trim() : ac;
        const c = bare || countyForZip(zip);
        if (c !== filterCounty) return false;
      }
      if (!isServer && !matchesDwellingType(l, filterType)) return false;
      if (!isServer && !matchesContact(l, filterContact)) return false;
      if (filterStatus && (l.status ?? 'new') !== filterStatus) return false;
      return true;
    });
  }, [leads, search, filterZip, filterCounty, filterType, filterStatus, filterContact, isServer]);

  const hasFilters = search || zipValue || countyValue || typeValue || filterStatus;

  const clearFilters = () => {
    setSearch('');
    setFilterZip('');
    setFilterCounty('');
    setFilterStatus('');
    setFilterType('');
    if (serverFilters) serverFilters.onChange({ county: '', zip: '', propertyType: '' });
  };

  const totalRows = filteredLeads.length;

  // Page-size options derived from how many rows there actually are (Frank Aug-2026).
  // The list used to be a fixed [25,50,100,250,500,All], so a 146-row result still
  // offered 250 and 500 — both of which do nothing. Only sizes smaller than the row
  // count are worth offering; "All" always covers the rest.
  const rowsPerPageOptions = useMemo(() => {
    const ceiling = Math.max(totalRows, totalAvailable ?? 0);
    const ladder = [25, 50, 100, 250, 500, 1000, 2500].filter((n) => n < ceiling);
    return [...ladder, { label: 'All', value: -1 }];
  }, [totalRows, totalAvailable]);

  // If the result set shrinks (a narrower filter), a previously chosen size can vanish
  // from the list, and MUI then renders a blank selector. Step DOWN to the largest size
  // still on offer rather than jumping to "All" — on the full book "All" means rendering
  // thousands of rows at once, which locks the page up. Derived rather than stored, so
  // there is never a render where the selected size is not one of the options.
  const activeRowsPerPage = useMemo(() => {
    const numeric = rowsPerPageOptions.filter((o): o is number => typeof o === 'number');
    if (rowsPerPage === -1 || numeric.includes(rowsPerPage)) return rowsPerPage;
    const smaller = numeric.filter((n) => n < rowsPerPage);
    return smaller.length ? Math.max(...smaller) : (numeric[0] ?? -1);
  }, [rowsPerPageOptions, rowsPerPage]);
  // rowsPerPage === -1 → "All" (show every loaded row on one page)
  const effRpp = activeRowsPerPage === -1 ? Math.max(totalRows, 1) : activeRowsPerPage;
  const maxPage = useMemo(() => Math.max(0, Math.ceil(totalRows / effRpp) - 1), [totalRows, effRpp]);
  const safePage = Math.min(page, maxPage);

  useEffect(() => { setPage(0); }, [leads, search, zipValue, countyValue, typeValue, filterStatus]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);
  // Tab change → reset to page 1 @ 25/page (Frank Jun-2026)
  useEffect(() => { setPage(0); setRowsPerPage(25); }, [resetKey]);

  const paginatedLeads = filteredLeads.slice(safePage * effRpp, safePage * effRpp + effRpp);
  const rangeStart = totalRows === 0 ? 0 : safePage * effRpp + 1;
  const rangeEnd = Math.min((safePage + 1) * effRpp, totalRows);

  // Shared pagination control — rendered above AND below the table (Frank Jun-2026).
  const renderPager = (loc: 'top' | 'bottom') => (
    <TablePagination
      key={loc}
      rowsPerPageOptions={rowsPerPageOptions}
      component="div"
      count={totalRows}
      rowsPerPage={activeRowsPerPage}
      page={safePage}
      onPageChange={(_e, p) => { setPage(p); onPageChange?.(p); }}
      onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); onRowsPerPageChange?.(parseInt(e.target.value, 10)); }}
      labelDisplayedRows={() => `${rangeStart}–${rangeEnd} of ${totalRows}`}
      showFirstButton
      showLastButton
      sx={{ '.MuiTablePagination-toolbar': { flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 0.5, px: { xs: 0, sm: 2 } } }}
    />
  );

  if (loading && leads.length === 0) {
    return <Paper sx={{ p: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress /></Paper>;
  }

  // NB: the empty state is rendered BELOW the filter bar, not instead of it. The
  // page-level filters (e.g. the Queue's effective-date range) are server-side, so
  // returning early here would hide the very controls needed to undo an empty result.
  const isEmpty = leads.length === 0;

  return (
    <Box>
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
          {extraFilters}
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
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>County</InputLabel>
            <Select value={countyValue} label="County" onChange={(e) => setCountyValue(e.target.value)}>
              <MenuItem value="">All Counties</MenuItem>
              {COUNTY_FILTER_OPTIONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>ZIP</InputLabel>
            <Select value={zipValue} label="ZIP" onChange={(e) => setZipValue(e.target.value)}>
              <MenuItem value="">All ZIPs</MenuItem>
              {zipChoices.map((z) => <MenuItem key={z} value={z}>{z}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 175 }}>
            <InputLabel>Property Type</InputLabel>
            <Select value={typeValue} label="Property Type" onChange={(e) => setTypeValue(e.target.value)}>
              {DWELLING_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 185 }}>
            <InputLabel>Contact</InputLabel>
            <Select value={contactValue} label="Contact" onChange={(e) => setContactValue(e.target.value)}>
              {CONTACT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Status</InputLabel>
            <Select value={filterStatus} label="Status" onChange={(e) => setFilterStatus(e.target.value)}>
              <MenuItem value="">All Statuses</MenuItem>
              <MenuItem value="new">New</MenuItem>
              <MenuItem value="rated">Rated</MenuItem>
              <MenuItem value="referral">Referral</MenuItem>
              <MenuItem value="indicative_sent">Indicative Sent</MenuItem>
              <MenuItem value="pos_ran">POS Ran</MenuItem>
              <MenuItem value="quote_issued">Quote Issued</MenuItem>
              <MenuItem value="bound">Bound</MenuItem>
              <MenuItem value="lost">Lost</MenuItem>
              <MenuItem value="quarantine">Quarantine</MenuItem>
            </Select>
          </FormControl>
          {hasFilters && (
            <Button size="small" startIcon={<ClearIcon />} onClick={clearFilters} color="inherit">
              Clear
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={14} color="inherit" /> : <GetAppIcon />}
            onClick={handleExport}
            disabled={exporting}
            size="small"
          >
            Export CSV
          </Button>
        </Stack>
      </Paper>

      {isEmpty ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="textSecondary" sx={{ mb: 1 }}>No leads found</Typography>
          <Typography variant="body2" color="textSecondary">
            Try widening the filters above — or clear the effective-date range.
          </Typography>
        </Paper>
      ) : (
      <>
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

      {renderPager('top')}

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
              <TableCell sx={{ fontWeight: 'bold', minWidth: 90 }} align="center">Effective</TableCell>
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
              <LeadRow key={getLeadRowKey(lead, safePage * effRpp + index)} lead={lead} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {renderPager('bottom')}
      </>
      )}
    </Box>
  );
}
