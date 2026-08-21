'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Container, Box, Typography, Paper, ToggleButton, ToggleButtonGroup, TextField,
  FormControl, InputLabel, Select, MenuItem, Button, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Stack, Tooltip,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import SearchIcon from '@mui/icons-material/Search';
import RoofingIcon from '@mui/icons-material/Roofing';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import DownloadIcon from '@mui/icons-material/Download';
import Link from 'next/link';

type ReportType = 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch' | 'owner_verify' | 'contact_coverage' | 'skiptrace_mismatch';

interface QcRow {
  propertyId: string; owner: string; city: string | null; zip: string | null;
  effectiveDate: string | null; grade: string | null; manualGrade: string | null;
  propertyType: string | null; travelersEligible: string | null; plymouthEligible: string | null;
  reason: string | null; context: string; by: string | null; at: string | null;
  hasPhone?: boolean; hasEmail?: boolean; hasDob?: boolean; isCondo?: boolean;
}

const REPORTS: { key: ReportType; label: string; icon: React.ReactNode; blurb: string }[] = [
  { key: 'referral', label: 'Referrals / Eligibility', icon: <FactCheckIcon />, blurb: 'Leads a carrier flagged Referral (or Non-eligible), with the reason entered.' },
  { key: 'grade_overrides', label: 'Grade Changes', icon: <SwapVertIcon />, blurb: 'Every manual grade change (B→A, A→D, …) with who/why — override validation.' },
  { key: 'keyword', label: 'Keyword Search', icon: <SearchIcon />, blurb: 'Search producer + variance notes and eligibility reasons for a keyword to spot trends.' },
  { key: 'roof_b', label: 'Grade-B: Roof Only', icon: <RoofingIcon />, blurb: 'Grade-B leads whose only knock is an unconfirmed roof (20+ yr home).' },
  { key: 'type_mismatch', label: 'Type Mismatch', icon: <ReportProblemIcon />, blurb: 'Leads a producer flagged where the REAPI property type looks wrong (e.g. condo that’s really a home).' },
  { key: 'owner_verify', label: 'WIP Verify Fails', icon: <PersonSearchIcon />, blurb: 'Leads that failed tax-roll verification — not found on the roll, or the insured name disagrees with it. Review before outreach.' },
  { key: 'contact_coverage', label: 'Contact Coverage', icon: <ContactPhoneIcon />, blurb: 'Rated accounts by property type (Condo/SFH) and contact status (phone-only / email-only / both / neither) + DOB. The no-email rows drive the downgrade decision.' },
  { key: 'skiptrace_mismatch', label: 'Name Mismatch', icon: <ReportProblemIcon />, blurb: 'Leads where the skip-trace insured name disagrees with the name on file — override per-lead from the card, then fix the carrier portal.' },
];

const gradeColor = (g: string | null) =>
  g === 'A' ? '#2e7d46' : g === 'B' ? '#c77a17' : g === 'C' ? '#c0522a' : '#6b7280';
const eligLabel = (v: string | null) => (v === 'review' ? 'Referral' : v === 'ineligible' ? 'Non-eligible' : v === 'eligible' ? 'Eligible' : '—');

export default function QcReportsPage() {
  const [report, setReport] = useState<ReportType>('referral');
  const [carrier, setCarrier] = useState<'any' | 'travelers' | 'plymouth'>('any');
  const [value, setValue] = useState<'review' | 'ineligible' | 'eligible'>('review');
  const [setBy, setSetBy] = useState<'any' | 'producer' | 'system'>('any');
  const [q, setQ] = useState('');
  const [effFrom, setEffFrom] = useState('');
  const [effTo, setEffTo] = useState('');
  // Contact-coverage drill-down: click a summary chip to filter the rows to that slice.
  const [covFilter, setCovFilter] = useState<'all' | 'sfh' | 'condo' | 'both' | 'phoneOnly' | 'emailOnly' | 'neither' | 'noEmail' | 'hasDob'>('all');
  const [rows, setRows] = useState<QcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const url = new URL('/api/admin/reports', window.location.origin);
      url.searchParams.set('report', report);
      if (report === 'referral') { url.searchParams.set('carrier', carrier); url.searchParams.set('value', value); url.searchParams.set('setBy', setBy); }
      if (report === 'keyword') url.searchParams.set('q', q.trim());
      if (effFrom) url.searchParams.set('effFrom', effFrom);
      if (effTo) url.searchParams.set('effTo', effTo);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Report failed');
      setRows(json.data || []);
      setRan(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [report, carrier, value, setBy, q, effFrom, effTo]);

  // Auto-run on report switch (except keyword, which waits for a term).
  useEffect(() => {
    setCovFilter('all'); // reset the coverage drill-down on report change
    if (report === 'keyword') { setRows([]); setRan(false); return; }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  const exportCsv = () => {
    const cols = ['Owner', 'City', 'ZIP', 'Eff Date', 'Grade', 'Manual', 'Type', 'Travelers', 'Plymouth', 'Reason', 'Detail', 'By', 'At'];
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.join(',')];
    for (const r of shownRows) lines.push([r.owner, r.city, r.zip, r.effectiveDate, r.grade, r.manualGrade, r.propertyType, eligLabel(r.travelersEligible), eligLabel(r.plymouthEligible), r.reason, r.context, r.by, r.at].map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BIA_QC_${report}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const active = REPORTS.find((r) => r.key === report)!;

  // Contact-coverage tallies (Frank's breakdown) — computed from the returned rows.
  const coverage = report === 'contact_coverage' && rows.length ? (() => {
    const t = {
      total: rows.length, sfh: 0, condo: 0,
      both: 0, phoneOnly: 0, emailOnly: 0, neither: 0, noEmail: 0, hasDob: 0,
    };
    for (const r of rows) {
      if (r.isCondo) t.condo++; else t.sfh++;
      if (r.hasPhone && r.hasEmail) t.both++;
      else if (r.hasPhone) t.phoneOnly++;
      else if (r.hasEmail) t.emailOnly++;
      else t.neither++;
      if (!r.hasEmail) t.noEmail++;
      if (r.hasDob) t.hasDob++;
    }
    return t;
  })() : null;

  // Rows actually shown in the table + exported: coverage drill-down filter applied.
  const shownRows = useMemo(() => {
    if (report !== 'contact_coverage' || covFilter === 'all') return rows;
    return rows.filter((r) => {
      switch (covFilter) {
        case 'sfh': return !r.isCondo;
        case 'condo': return !!r.isCondo;
        case 'both': return !!r.hasPhone && !!r.hasEmail;
        case 'phoneOnly': return !!r.hasPhone && !r.hasEmail;
        case 'emailOnly': return !r.hasPhone && !!r.hasEmail;
        case 'neither': return !r.hasPhone && !r.hasEmail;
        case 'noEmail': return !r.hasEmail;
        case 'hasDob': return !!r.hasDob;
        default: return true;
      }
    });
  }, [rows, report, covFilter]);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>QC / Data Validation</Typography>
        <Typography variant="body1" color="text.secondary">
          Pull producer notes, variance notes, eligibility &amp; grade overrides back out — spot trends without leaving the CRM.
        </Typography>
      </Box>

      <ToggleButtonGroup
        value={report} exclusive size="small" sx={{ mb: 2, flexWrap: 'wrap' }}
        onChange={(_e, v) => { if (v) setReport(v); }}
      >
        {REPORTS.map((r) => (
          <ToggleButton key={r.key} value={r.key} sx={{ textTransform: 'none', gap: 0.75 }}>
            {r.icon} {r.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{active.blurb}</Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, flexWrap: 'wrap' }}>
          {report === 'referral' && (
            <>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Carrier</InputLabel>
                <Select label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as any)}>
                  <MenuItem value="any">Either carrier</MenuItem>
                  <MenuItem value="travelers">Travelers</MenuItem>
                  <MenuItem value="plymouth">Plymouth Rock</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Status</InputLabel>
                <Select label="Status" value={value} onChange={(e) => setValue(e.target.value as any)}>
                  <MenuItem value="review">Referral</MenuItem>
                  <MenuItem value="ineligible">Non-eligible</MenuItem>
                  <MenuItem value="eligible">Eligible</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 190 }}>
                <InputLabel>Set by</InputLabel>
                <Select label="Set by" value={setBy} onChange={(e) => setSetBy(e.target.value as any)}>
                  <MenuItem value="any">Anyone</MenuItem>
                  <MenuItem value="producer">Producer-reviewed</MenuItem>
                  <MenuItem value="system">System-flagged</MenuItem>
                </Select>
              </FormControl>
            </>
          )}
          {report === 'keyword' && (
            <TextField
              size="small" label="Keyword" value={q} placeholder='e.g. "Howell", "referral", "Travelers declined"'
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              sx={{ minWidth: 320 }}
            />
          )}
          <TextField size="small" type="date" label="Eff from" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField size="small" type="date" label="Eff to" value={effTo} onChange={(e) => setEffTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Button variant="contained" size="small" startIcon={<SearchIcon />} onClick={run} disabled={loading || (report === 'keyword' && !q.trim())}>Run</Button>
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={exportCsv} disabled={!shownRows.length}>Export CSV</Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {coverage && (() => {
        // Clickable chip → filter the table to that slice. Clicking the active one clears it.
        const covChip = (key: typeof covFilter, label: string, sx: any) => {
          const active = covFilter === key;
          return (
            <Chip
              label={label} size="small" clickable
              onClick={() => setCovFilter(active ? 'all' : key)}
              sx={{ ...sx, cursor: 'pointer', outline: active ? '2px solid #1565c0' : 'none', outlineOffset: 1 }}
            />
          );
        };
        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Rated accounts — contact coverage ({coverage.total}){covFilter !== 'all' ? ` · showing ${shownRows.length}` : ''}
              </Typography>
              {covFilter !== 'all' && (
                <Button size="small" onClick={() => setCovFilter('all')}>Clear filter</Button>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Click a chip to filter the list below.</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {covChip('sfh', `SFH: ${coverage.sfh}`, { bgcolor: '#dcfce7', color: '#166534', fontWeight: 700 })}
              {covChip('condo', `Condo: ${coverage.condo}`, { bgcolor: '#ede9fe', color: '#5b21b6', fontWeight: 700 })}
              <Box sx={{ width: 1, alignSelf: 'stretch', borderLeft: '1px solid', borderColor: 'divider', mx: 0.5 }} />
              {covChip('both', `Phone + Email: ${coverage.both}`, { bgcolor: '#dcfce7', color: '#166534' })}
              {covChip('phoneOnly', `Phone only: ${coverage.phoneOnly}`, { bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 })}
              {covChip('emailOnly', `Email only: ${coverage.emailOnly}`, { bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 })}
              {covChip('neither', `Neither: ${coverage.neither}`, { bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 })}
              <Box sx={{ width: 1, alignSelf: 'stretch', borderLeft: '1px solid', borderColor: 'divider', mx: 0.5 }} />
              {covChip('noEmail', `No email (downgrade review): ${coverage.noEmail}`, { bgcolor: '#fff', color: '#b3261e', fontWeight: 600, border: '1px solid #f2a3a3' })}
              {covChip('hasDob', `Has DOB: ${coverage.hasDob}`, { border: '1px solid', borderColor: 'divider' })}
            </Stack>
          </Paper>
        );
      })()}

      <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        {loading ? <CircularProgress size={18} /> : <Typography variant="body2" color="text.secondary"><strong>{shownRows.length}</strong> record{shownRows.length === 1 ? '' : 's'}</Typography>}
      </Box>

      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {['Owner', 'City / ZIP', 'Eff Date', 'Grade', 'Type', 'Travelers', 'Plymouth', 'Reason', 'Detail', 'By'].map((h) => (
                <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {shownRows.map((r) => (
              <TableRow key={r.propertyId + r.context} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Link href={`/leads/${r.propertyId}`} style={{ color: '#1565c0', textDecoration: 'none' }}>{r.owner}</Link>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.city} <span style={{ color: '#9098a6', fontSize: 12 }}>{r.zip}</span></TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.effectiveDate ?? '—'}</TableCell>
                <TableCell>
                  <Chip label={r.grade ?? '?'} size="small" sx={{ bgcolor: gradeColor(r.grade), color: '#fff', fontWeight: 700, height: 20 }} />
                  {r.manualGrade && <Tooltip title="Manual override"><span style={{ marginLeft: 4, fontSize: 11, color: '#8a5a00' }}>✎</span></Tooltip>}
                </TableCell>
                <TableCell>{r.propertyType ?? '—'}</TableCell>
                <TableCell>{eligLabel(r.travelersEligible)}</TableCell>
                <TableCell>{eligLabel(r.plymouthEligible)}</TableCell>
                <TableCell sx={{ fontSize: 12.5 }}>
                  {r.reason
                    ? <Chip label={r.reason} size="small" sx={{ height: 20, fontSize: 11, bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 }} />
                    : <span style={{ color: '#b0b6c0' }}>—</span>}
                </TableCell>
                <TableCell sx={{ maxWidth: 380, fontSize: 12.5, color: '#3d4658' }}>{r.context}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 12, color: '#616b7d' }}>{r.by ?? '—'}</TableCell>
              </TableRow>
            ))}
            {!loading && ran && shownRows.length === 0 && (
              <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: '#888' }}>No records match.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Container>
  );
}
