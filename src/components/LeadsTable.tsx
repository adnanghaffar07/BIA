'use client';

import React, { useState, Fragment, useEffect, useMemo } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, IconButton, Box, TablePagination, CircularProgress,
  Typography, Button, Stack, Collapse, Chip,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import GetAppIcon from '@mui/icons-material/GetApp';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
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
  const addr = getAddress(lead);
  const grade = lead.grade as LeadGrade | null;

  return (
    <Fragment>
      <TableRow
        hover
        onClick={() => setOpen((p) => !p)}
        sx={{
          cursor: 'pointer',
          backgroundColor: open ? EXPANDED_ROW_HEADER_BG : 'background.paper',
          '& > td': { borderBottom: open ? 'none' : undefined, backgroundColor: 'inherit' },
        }}
      >
        <TableCell padding="checkbox" sx={{ width: 48 }}>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen((p) => !p); }}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>

        {/* Grade */}
        <TableCell sx={{ width: 140 }}>
          {grade ? (
            <LeadGradeBadge grade={grade} size="small" showLabel={false} />
          ) : (
            <Typography variant="caption" color="textSecondary">—</Typography>
          )}
        </TableCell>

        {/* Owner */}
        <TableCell>
          <Stack spacing={0}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{getOwnerDisplayName(lead)}</Typography>
          </Stack>
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
            <Stack alignItems="flex-end" spacing={0}>
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

        {/* Beds / Baths */}
        <TableCell align="center">{lead.bedrooms ?? '-'}</TableCell>
        <TableCell align="center">{lead.bathrooms ?? '-'}</TableCell>
      </TableRow>

      {/* Expanded detail row */}
      <TableRow sx={{ backgroundColor: open ? EXPANDED_ROW_BG : 'inherit' }}>
        <TableCell
          colSpan={COLUMN_COUNT}
          sx={{ py: 0, px: 0, borderBottom: open ? undefined : 'none', backgroundColor: open ? EXPANDED_ROW_BG : 'inherit' }}
        >
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ px: 3, pb: 3, pt: 1, backgroundColor: EXPANDED_ROW_BG, borderTop: '1px solid', borderColor: '#b6cce8' }}>
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
  const totalRows = leads.length;
  const maxPage = useMemo(() => Math.max(0, Math.ceil(totalRows / rowsPerPage) - 1), [totalRows, rowsPerPage]);
  const safePage = Math.min(page, maxPage);

  useEffect(() => { setPage(0); }, [leads]);
  useEffect(() => { if (fetchSize > 0) { setRowsPerPage(fetchSize); setPage(0); } }, [fetchSize]);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);

  const paginatedLeads = leads.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage);
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          {totalRows.toLocaleString()} Leads
          {loading && totalRows > 0 && <CircularProgress size={16} sx={{ ml: 1.5, verticalAlign: 'middle' }} />}
        </Typography>
        <Button variant="outlined" startIcon={<GetAppIcon />} onClick={() => exportLeadsToCSV(leads)} size="small">
          Export CSV
        </Button>
      </Box>

      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Click any row to expand full property details
      </Typography>

      <TableContainer component={Paper}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 48 }} />
              <TableCell sx={{ fontWeight: 'bold', minWidth: 110 }}>Grade</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }}>Owner</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 160 }}>Address</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 130 }}>City / State</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 130 }}>Pipeline</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 120 }}>Carriers</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 140 }} align="right">Est. Premium</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 110 }} align="right">Est. Value</TableCell>
              <TableCell sx={{ fontWeight: 'bold', minWidth: 80 }} align="right">Sq Ft</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">Beds</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">Baths</TableCell>
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
