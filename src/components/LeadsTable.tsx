'use client';

import React, { useState, Fragment, useEffect, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Box,
  TablePagination,
  CircularProgress,
  Typography,
  Button,
  Stack,
  Collapse,
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import GetAppIcon from '@mui/icons-material/GetApp';
import { Lead } from '@/types/lead';
import { formatCurrency } from '@/utils/formatAddress';
import { exportLeadsToCSV } from '@/utils/csvExport';
import PropertyDetailsContent from '@/components/PropertyDetailsContent';

interface LeadsTableProps {
  leads: Lead[];
  loading?: boolean;
  /** Matches API fetch size from search — keeps table page size in sync */
  fetchSize?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (rowsPerPage: number) => void;
}

function getLeadRowKey(lead: Lead, index: number): string {
  return lead.propertyId || lead.id || `lead-row-${index}`;
}

const COLUMN_COUNT = 10;

/** Distinct from layout page bg (#f5f5f5) and table paper (white) */
const EXPANDED_ROW_BG = '#e3edf7';
const EXPANDED_ROW_HEADER_BG = '#d4e4f5';

function getOwnerDisplayName(lead: Lead): string {
  if (lead.companyName) return lead.companyName;
  if (lead.owner1LastName) return lead.owner1LastName;
  return '—';
}

function LeadRow({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);

  const toggleOpen = () => setOpen((prev) => !prev);

  return (
    <Fragment>
      <TableRow
        hover
        onClick={toggleOpen}
        sx={{
          cursor: 'pointer',
          backgroundColor: open ? EXPANDED_ROW_HEADER_BG : 'background.paper',
          '& > td': {
            borderBottom: open ? 'none' : undefined,
            backgroundColor: 'inherit',
          },
        }}
      >
        <TableCell padding="checkbox" sx={{ width: 48 }}>
          <IconButton
            aria-label={open ? 'Collapse row' : 'Expand row'}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              toggleOpen();
            }}
          >
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Stack spacing={0}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {getOwnerDisplayName(lead)}
            </Typography>
            {lead.companyName && lead.owner1LastName && (
              <Typography variant="caption" color="textSecondary">
                {lead.owner1LastName}
              </Typography>
            )}
          </Stack>
        </TableCell>
        <TableCell>
          <Stack spacing={0}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {lead.address?.street || '—'}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {lead.address?.zip}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell>
          {lead.address?.city}, {lead.address?.state}
        </TableCell>
        <TableCell>
          {lead.propertyType || lead.propertyUse || 'N/A'}
        </TableCell>
        <TableCell align="center">{lead.bedrooms ?? '-'}</TableCell>
        <TableCell align="center">{lead.bathrooms ?? '-'}</TableCell>
        <TableCell align="right">
          {lead.estimatedValue ? formatCurrency(lead.estimatedValue) : '-'}
        </TableCell>
        <TableCell align="right">
          {lead.squareFeet ? lead.squareFeet.toLocaleString() : '-'}
        </TableCell>
        <TableCell>{lead.landUse || '—'}</TableCell>
      </TableRow>
      <TableRow sx={{ backgroundColor: open ? EXPANDED_ROW_BG : 'inherit' }}>
        <TableCell
          colSpan={COLUMN_COUNT}
          sx={{
            py: 0,
            px: 0,
            borderBottom: open ? undefined : 'none',
            backgroundColor: open ? EXPANDED_ROW_BG : 'inherit',
          }}
        >
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box
              sx={{
                px: 3,
                pb: 3,
                pt: 1,
                backgroundColor: EXPANDED_ROW_BG,
                borderTop: '1px solid',
                borderColor: '#b6cce8',
              }}
            >
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

  const maxPage = useMemo(
    () => Math.max(0, Math.ceil(totalRows / rowsPerPage) - 1),
    [totalRows, rowsPerPage]
  );

  const safePage = Math.min(page, maxPage);

  // Reset to first page when a new result set is loaded
  useEffect(() => {
    setPage(0);
  }, [leads]);

  // Align rows-per-page with search "Results per page" when it changes
  useEffect(() => {
    if (fetchSize > 0) {
      setRowsPerPage(fetchSize);
      setPage(0);
    }
  }, [fetchSize]);

  // Keep page index valid when rows shrink (filters, smaller fetch, etc.)
  useEffect(() => {
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, maxPage]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
    onPageChange?.(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    setRowsPerPage(newRowsPerPage);
    setPage(0);
    onRowsPerPageChange?.(newRowsPerPage);
  };

  const handleExportCSV = () => {
    exportLeadsToCSV(leads);
  };

  const paginatedLeads = leads.slice(
    safePage * rowsPerPage,
    safePage * rowsPerPage + rowsPerPage
  );

  const rangeStart = totalRows === 0 ? 0 : safePage * rowsPerPage + 1;
  const rangeEnd = Math.min((safePage + 1) * rowsPerPage, totalRows);

  if (loading && leads.length === 0) {
    return (
      <Paper sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Paper>
    );
  }

  if (leads.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="textSecondary" sx={{ mb: 2 }}>
          No properties found
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Try adjusting your search filters
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">
          Total Leads: {totalRows}
          {loading && totalRows > 0 && (
            <CircularProgress size={16} sx={{ ml: 1.5, verticalAlign: 'middle' }} />
          )}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<GetAppIcon />}
          onClick={handleExportCSV}
          size="small"
        >
          Export CSV
        </Button>
      </Box>

      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
        Click a row to expand and view full property details
      </Typography>

      <TableContainer component={Paper}>
        <Table stickyHeader>
          <TableHead>
            <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
              <TableCell sx={{ width: 48 }} />
              <TableCell sx={{ fontWeight: 'bold' }}>Owner Name</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Address</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>City/State</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">
                Beds
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="center">
                Baths
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">
                Est. Value
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold' }} align="right">
                Sq Ft
              </TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Land Use</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedLeads.map((lead, index) => (
              <LeadRow
                key={`${getLeadRowKey(lead, safePage * rowsPerPage + index)}`}
                lead={lead}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        rowsPerPageOptions={[5, 10, 20, 25, 50, 100]}
        component="div"
        count={totalRows}
        rowsPerPage={rowsPerPage}
        page={safePage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        labelDisplayedRows={() =>
          `${rangeStart}-${rangeEnd} of ${totalRows}`
        }
        showFirstButton
        showLastButton
      />
    </Box>
  );
}
