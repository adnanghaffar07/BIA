'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Container, Box, Typography, Paper, ToggleButton, ToggleButtonGroup, TextField,
  FormControl, InputLabel, Select, MenuItem, Button, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Stack, Tooltip,
  Divider,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import SearchIcon from '@mui/icons-material/Search';
import RoofingIcon from '@mui/icons-material/Roofing';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import BoltIcon from '@mui/icons-material/Bolt';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
// Type-only import: erased at build, so the server-side reports module never reaches
// the browser bundle. One definition of a report row, shared by producer and consumer.
import type { QcRow } from '@/services/reports.service';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import DownloadIcon from '@mui/icons-material/Download';
import Link from 'next/link';
import { useStickyState } from '@/hooks/useStickyState';

type ReportType = 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch' | 'owner_verify' | 'contact_coverage' | 'skiptrace_mismatch' | 'blast_skiptrace' | 'cohort' | 'reachability';


const REPORTS: { key: ReportType; label: string; icon: React.ReactNode; blurb: string }[] = [
  { key: 'reachability', label: 'Reachability', icon: <ContactPhoneIcon />, blurb: 'Per renewal week: how many households we can reach at the named insured, how many only at the co-insured, and what the insured-only rule costs us in reach.' },
  { key: 'cohort', label: 'Renewal Week', icon: <CalendarMonthIcon />, blurb: 'Every lead whose renewal falls in the chosen effective-date range — the whole cohort, graded or not, with grade, status and how many are actually reachable.' },
  { key: 'referral', label: 'Referrals / Eligibility', icon: <FactCheckIcon />, blurb: 'Leads a carrier flagged Referral (or Non-eligible), with the reason entered.' },
  { key: 'grade_overrides', label: 'Grade Changes', icon: <SwapVertIcon />, blurb: 'Grade changes from both sides — a producer overriding with a reason, and the rules re-grading a lead. The system tab also flags leads whose stored grade no longer agrees with the rules.' },
  { key: 'keyword', label: 'Keyword Search', icon: <SearchIcon />, blurb: 'Search producer + variance notes and eligibility reasons for a keyword to spot trends.' },
  { key: 'roof_b', label: 'Grade-B: Roof Only', icon: <RoofingIcon />, blurb: 'Grade-B leads whose only knock is an unconfirmed roof (20+ yr home).' },
  { key: 'type_mismatch', label: 'Type Mismatch', icon: <ReportProblemIcon />, blurb: 'Leads a producer flagged where the REAPI property type looks wrong (e.g. condo that’s really a home).' },
  { key: 'owner_verify', label: 'WIP Verify Fails', icon: <PersonSearchIcon />, blurb: 'Leads that failed tax-roll verification — not found on the roll, or the insured name disagrees with it. Review before outreach.' },
  { key: 'contact_coverage', label: 'Contact Coverage', icon: <ContactPhoneIcon />, blurb: 'Rated accounts by property type (Condo/SFH) and contact status (phone-only / email-only / both / neither) + DOB. The no-email rows drive the downgrade decision.' },
  { key: 'skiptrace_mismatch', label: 'Name Mismatch', icon: <ReportProblemIcon />, blurb: 'Leads where the skip-trace insured name disagrees with the name on file — override per-lead from the card, then fix the carrier portal.' },
  { key: 'blast_skiptrace', label: 'Blast Skip Traces', icon: <BoltIcon />, blurb: 'Leads traced by a Grade-A cohort blast rather than by hand — when it ran, who ran it, what each lead returned and what it cost. Grouped by run.' },
];

const gradeColor = (g: string | null) =>
  g === 'A' ? '#2e7d46' : g === 'B' ? '#c77a17' : g === 'C' ? '#c0522a' : '#6b7280';
const eligLabel = (v: string | null) => (v === 'review' ? 'Referral' : v === 'ineligible' ? 'Non-eligible' : v === 'eligible' ? 'Eligible' : '—');

const yn = (v: unknown) => (v ? 'Yes' : 'No');

/**
 * ONE column definition per report, used by BOTH the table and the CSV export.
 *
 * They used to be declared separately — eleven hardcoded <TableCell>s in the table and a
 * different hand-written list in exportCsv. The two had already drifted: the CSV split
 * City and ZIP, carried a "Manual" column the table showed only as a pencil icon, and on
 * the Reachability tab wrote an entirely different set of ten columns from the eleven on
 * screen. Anyone reconciling the file against the page would have found a different
 * shape and reasonably concluded one of them was wrong.
 *
 * `value` is the exported string and the fallback rendering; `cell` is the richer
 * on-screen version when one is wanted. The CSV therefore cannot say anything the table
 * does not, and a new column appears in both or neither.
 */
type QcColumn = {
  header: string;
  value: (r: QcRow) => string;
  cell?: (r: QcRow) => React.ReactNode;
  /** Right-aligned in the table; numbers read better that way. */
  numeric?: boolean;
};

function columnsFor(report: ReportType): QcColumn[] {
  const base: QcColumn[] = [
    {
      header: 'Owner',
      value: (r) => r.owner,
      cell: (r) => (
        <Link href={`/leads/${r.propertyId}`} style={{ color: '#1565c0', textDecoration: 'none' }}>{r.owner}</Link>
      ),
    },
    {
      header: 'City / ZIP',
      value: (r) => [r.city, r.zip].filter(Boolean).join(' ') || '—',
      cell: (r) => <>{r.city} <span style={{ color: '#9098a6', fontSize: 12 }}>{r.zip}</span></>,
    },
    { header: 'Eff Date', value: (r) => r.effectiveDate ?? '—' },
    {
      header: 'Grade',
      /**
       * The one cell that cannot be byte-identical to the table: on screen an override is
       * a ✎ icon next to the chip, and an icon has no text form. The CSV says it in words
       * instead, so the file carries the same FACT even though the characters differ.
       *
       * Two spellings because "A (manual: A)" is nonsense — when the override agrees with
       * the grade the only thing worth saying is that a producer set it deliberately.
       */
      value: (r) => {
        const g = r.grade ?? '?';
        if (!r.manualGrade) return g;
        return r.manualGrade === r.grade ? `${g} (manual override)` : `${g} (manual: ${r.manualGrade})`;
      },
      cell: (r) => (
        <>
          <Chip label={r.grade ?? '?'} size="small" sx={{ bgcolor: gradeColor(r.grade), color: '#fff', fontWeight: 700, height: 20 }} />
          {r.manualGrade && <Tooltip title="Manual override"><span style={{ marginLeft: 4, fontSize: 11, color: '#8a5a00' }}>✎</span></Tooltip>}
        </>
      ),
    },
    { header: 'Type', value: (r) => r.propertyType ?? '—' },
    { header: 'Travelers', value: (r) => eligLabel(r.travelersEligible) },
    { header: 'Plymouth', value: (r) => eligLabel(r.plymouthEligible) },
    {
      // The `reason` field carries a different thing per report, so it gets the name of
      // whatever it actually holds rather than a catch-all "Reason".
      header: report === 'cohort' ? 'Status' : report === 'reachability' ? 'Renewal Week' : 'Reason',
      value: (r) => r.reason ?? '—',
      cell: (r) => (r.reason
        ? <Chip label={r.reason} size="small" sx={{ height: 20, fontSize: 11, bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 }} />
        : <span style={{ color: '#b0b6c0' }}>—</span>),
    },
  ];

  // Per-report facts. These were previously visible only as prose inside Detail, which
  // meant they could not be sorted or filtered in a spreadsheet.
  const extras: QcColumn[] = report === 'cohort'
    ? [
        { header: 'Insured Email', value: (r) => yn(r.hasInsuredEmail) },
        { header: 'Co-Insured Email', value: (r) => yn(r.hasCoInsuredEmail) },
        { header: 'Insured Phone', value: (r) => yn(r.hasInsuredPhone) },
        { header: 'Co-Insured Phone', value: (r) => yn(r.hasCoInsuredPhone) },
        { header: 'Deep Traced', value: (r) => yn(r.matched) },
      ]
    : report === 'reachability'
      ? [
          { header: 'Insured Emails', value: (r) => String(r.insuredEmailCount ?? 0), numeric: true },
          { header: 'Co-Insured Only', value: (r) => yn(r.coInsuredOnly) },
          { header: 'Reachable', value: (r) => yn((r.insuredEmailCount ?? 0) > 0 || r.coInsuredOnly) },
        ]
      : report === 'contact_coverage'
        ? [
            { header: 'Phone', value: (r) => yn(r.hasPhone) },
            { header: 'Email', value: (r) => yn(r.hasEmail) },
            { header: 'DOB', value: (r) => yn(r.hasDob) },
            { header: 'Condo', value: (r) => yn(r.isCondo) },
          ]
        : report === 'blast_skiptrace'
          ? [
              { header: 'Matched', value: (r) => yn(r.matched) },
              { header: 'Phone Found', value: (r) => yn(r.hasPhone) },
              { header: 'Email Found', value: (r) => yn(r.hasEmail) },
            ]
          : [];

  return [
    ...base,
    ...extras,
    { header: 'Detail', value: (r) => r.context },
    { header: 'By', value: (r) => r.by ?? '—' },
    { header: 'When', value: (r) => r.at ?? '—' },
  ];
}

export default function QcReportsPage() {
  // Filters persist across navigation until reset (Frank Aug-2026).
  const [report, setReport] = useStickyState<ReportType>('qc:report', 'referral');
  const [carrier, setCarrier] = useStickyState<'any' | 'travelers' | 'plymouth'>('qc:carrier', 'any');
  const [value, setValue] = useStickyState<'review' | 'ineligible' | 'eligible'>('qc:value', 'review');
  const [setBy, setSetBy] = useStickyState<'any' | 'producer' | 'system'>('qc:setBy', 'any');
  const [q, setQ] = useStickyState('qc:q', '');
  const [effFrom, setEffFrom] = useStickyState('qc:effFrom', '');
  const [effTo, setEffTo] = useStickyState('qc:effTo', '');
  // Contact-coverage drill-down: click a summary chip to filter the rows to that slice.
  /** Drill-down on the Renewal Week summary: click a chip to filter, click again to clear. */
  const [cohortFilter, setCohortFilter] = useState<{ kind: 'grade' | 'status' | 'trait'; value: string } | null>(null);
  /** Reachability drill-down: which slice of the population the table is narrowed to. */
  const [reachFilter, setReachFilter] = useState<'all' | 'insured' | 'coOnly' | 'unreachable'>('all');
  const [covFilter, setCovFilter] = useState<'all' | 'sfh' | 'condo' | 'both' | 'phoneOnly' | 'emailOnly' | 'neither' | 'noEmail' | 'hasDob'>('all');
  const [rows, setRows] = useState<QcRow[]>([]);
  // Credit status is shown as a warning only — never as a per-lead number
  // (Frank Sep-2026). Null until loaded, or when no balance has been recorded.
  const [credits, setCredits] = useState<{ known: boolean; low: boolean; remaining: number | null; matchesRemaining: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  // Which report the rows in state actually came from. Switching reports keeps the
  // old rows on screen until the new fetch lands, so a summary computed from "rows"
  // would describe the previous report — the blast summary read 974 leads from the
  // Referrals list. Summaries render only once this matches.
  const [rowsReport, setRowsReport] = useState<ReportType | null>(null);

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
      setRowsReport(report);
      setRan(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed');
      setRows([]);
      setRowsReport(null);
    } finally {
      setLoading(false);
    }
  }, [report, carrier, value, setBy, q, effFrom, effTo]);

  // Auto-run on report switch (except keyword, which waits for a term).
  useEffect(() => {
    setCovFilter('all'); // reset the coverage drill-down on report change
    setCohortFilter(null);
    setReachFilter('all'); // reset the reachability drill-down on report change
    // Renewal Week without a range means the entire book — nearly 10,000 rows over the
    // wire for a report whose whole point is one week. It waits for dates, the same way
    // keyword waits for a term.
    if (report === 'keyword' || (report === 'cohort' && !effFrom && !effTo)) {
      setRows([]); setRowsReport(null); setRan(false); return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  /**
   * Export exactly what is on screen.
   *
   * Columns come from columnsFor(report) — the same definition the table renders — so the
   * file cannot have a different shape from the page. Rows come from `shownRows`, which is
   * the filtered set, so whatever drill-down chip is active is what lands in the file.
   *
   * The table caps rendering at MAX_RENDERED for speed; the CSV deliberately writes every
   * matching row, which is the one place the two differ and the only sane way round.
   */
  const exportCsv = () => {
    const cols = tableColumns;

    const esc = (v: string) => {
      let s = String(v ?? '');
      // A cell starting with = + - @ is executed as a formula by Excel and Sheets when
      // the file is opened. These rows carry producer-typed notes, so that is a real
      // risk rather than a theoretical one. Prefixing an apostrophe neutralises it.
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [cols.map((c) => esc(c.header)).join(',')];
    for (const r of shownRows) lines.push(cols.map((c) => esc(c.value(r))).join(','));

    // CRLF and a UTF-8 BOM, both for Excel. Without the BOM it reads the file as ANSI and
    // the em dashes and middot separators in Detail come out as mojibake — the export
    // then visibly does NOT match the screen, which is the whole point of this function.
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });

    // Name says which report, and whether it is filtered — so a narrowed export is never
    // mistaken later for the full set.
    const filtered = shownRows.length !== rows.length ? '_filtered' : '';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BIA_QC_${report}${filtered}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Only the blast report cares about credits, so only it pays for the lookup.
  // Nothing is cleared on the way out: the warning's own render already checks the
  // selected report, so a stale balance can never surface under a different one.
  useEffect(() => {
    if (report !== 'blast_skiptrace') return;
    let cancelled = false;
    fetch('/api/admin/credits')
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.success) setCredits(j); })
      .catch(() => { /* a missing balance is not an error worth shouting about */ });
    return () => { cancelled = true; };
  }, [report]);

  const active = REPORTS.find((r) => r.key === report)!;

  /**
   * The columns for whichever report is selected. Rebuilt only when the report changes,
   * and shared by the table and Export CSV so the file always matches the page.
   *
   * Keyed off `rowsReport`, not `report`: switching tabs leaves the previous report's
   * rows on screen until the new fetch lands, and drawing the NEW report's columns over
   * the OLD report's rows would show empty cells for a moment and — worse — export them
   * that way if someone clicked during the fetch.
   */
  const tableColumns = useMemo(() => columnsFor(rowsReport ?? report), [rowsReport, report]);

  // Contact-coverage tallies (Frank's breakdown) — computed from the returned rows.
  /**
   * Renewal-week tallies. Counted from the rows rather than fetched separately, so the
   * summary can never disagree with the table underneath it — the two are the same data.
   * manualGrade wins over grade because an override is the grade a producer stands behind.
   */
  const cohort = report === 'cohort' && rowsReport === report && rows.length ? (() => {
    const grades: Record<string, number> = {};
    const statuses: Record<string, number> = {};
    // Split by person. The insured is who campaigns actually mail; the co-insured is
    // reach we hold but do not use, and rolling the two together hid that.
    let traced = 0, insuredEmail = 0, coInsuredEmail = 0, insuredPhone = 0, coInsuredPhone = 0;
    for (const r of rows) {
      const g = r.manualGrade || r.grade || 'ungraded';
      grades[g] = (grades[g] ?? 0) + 1;
      const s = r.reason || '(none)';
      statuses[s] = (statuses[s] ?? 0) + 1;
      if (r.matched) traced++;
      if (r.hasInsuredEmail) insuredEmail++;
      if (r.hasCoInsuredEmail) coInsuredEmail++;
      if (r.hasInsuredPhone) insuredPhone++;
      if (r.hasCoInsuredPhone) coInsuredPhone++;
    }
    return { total: rows.length, grades, statuses, traced, insuredEmail, coInsuredEmail, insuredPhone, coInsuredPhone };
  })() : null;

  /**
   * Reachability per renewal week.
   *
   * Computed from the same rows the table shows, so the summary can never disagree with
   * what is underneath it. "Co-insured only" is the number that matters: those households
   * are unreachable today purely because of the insured-only rule.
   */
  const reach = report === 'reachability' && rowsReport === report && rows.length ? (() => {
    const byCohort = new Map<string, { cohort: string; label: string; total: number; insured: number; coOnly: number }>();
    for (const r of rows) {
      const key = r.cohort ?? 'untagged';
      const cur = byCohort.get(key) ?? { cohort: key, label: r.reason ?? '—', total: 0, insured: 0, coOnly: 0 };
      cur.total++;
      if ((r.insuredEmailCount ?? 0) > 0) cur.insured++;
      else if (r.coInsuredOnly) cur.coOnly++;
      byCohort.set(key, cur);
    }
    const weeks = [...byCohort.values()].sort((a, b) => (a.cohort < b.cohort ? -1 : 1));
    const t = weeks.reduce((a, w) => ({
      total: a.total + w.total, insured: a.insured + w.insured, coOnly: a.coOnly + w.coOnly,
    }), { total: 0, insured: 0, coOnly: 0 });
    return { weeks, ...t };
  })() : null;

  const coverage = report === 'contact_coverage' && rowsReport === report && rows.length ? (() => {
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

  // Blast runs — one row per run, newest first. Match counts only: what the run
  // recovered is a QC question, what it cost is not (Frank Sep-2026).
  const blastRuns = report === 'blast_skiptrace' && rowsReport === report && rows.length ? (() => {
    const byRun = new Map<string, { runId: string; when: string; by: string; leads: number; hits: number; phone: number; email: number }>();
    for (const r of rows) {
      const key = r.runId ?? 'unknown';
      const cur = byRun.get(key) ?? { runId: key, when: r.at ?? '—', by: r.by ?? '—', leads: 0, hits: 0, phone: 0, email: 0 };
      cur.leads++;
      if (r.matched) cur.hits++;
      if (r.hasPhone) cur.phone++;
      if (r.hasEmail) cur.email++;
      // Rows arrive newest-first, so the last one seen is the run's earliest stamp.
      if (r.at && r.at < cur.when) cur.when = r.at;
      byRun.set(key, cur);
    }
    return [...byRun.values()].sort((a, b) => (a.when < b.when ? 1 : -1));
  })() : null;

  // Rows actually shown in the table + exported: coverage drill-down filter applied.
/**
 * Rows rendered at once. A renewal-week cohort is ~1,500 leads and rendering every one
 * as a MUI TableRow locks the page for seconds — the summary above already carries the
 * totals, and Export CSV still writes the COMPLETE set, so the table only has to be
 * enough to eyeball.
 */
const MAX_RENDERED = 300;

  const shownRows = useMemo(() => {
    if (report === 'cohort') {
      if (!cohortFilter) return rows;
      const { kind, value } = cohortFilter;
      return rows.filter((r) => {
        if (kind === 'grade') return (r.manualGrade || r.grade || 'ungraded') === value;
        if (kind === 'status') return (r.reason || '(none)') === value;
        if (value === 'traced') return !!r.matched;
        if (value === 'insuredEmail') return !!r.hasInsuredEmail;
        if (value === 'coInsuredEmail') return !!r.hasCoInsuredEmail;
        if (value === 'insuredPhone') return !!r.hasInsuredPhone;
        if (value === 'coInsuredPhone') return !!r.hasCoInsuredPhone;
        return true;
      });
    }
    if (report === 'reachability') {
      if (reachFilter === 'all') return rows;
      return rows.filter((r) => {
        const ins = (r.insuredEmailCount ?? 0) > 0;
        if (reachFilter === 'insured') return ins;
        if (reachFilter === 'coOnly') return !ins && !!r.coInsuredOnly;
        return !ins && !r.coInsuredOnly;
      });
    }
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
  }, [rows, report, covFilter, cohortFilter, reachFilter]);

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

      {cohort && (() => {
        // Every chip is a filter. Clicking the active one clears it, so there is no
        // separate "reset" to hunt for — the way out is the way in.
        const chip = (
          kind: 'grade' | 'status' | 'trait',
          value: string,
          label: string,
          sx: Record<string, unknown> = {},
        ) => {
          const active = cohortFilter?.kind === kind && cohortFilter?.value === value;
          return (
            <Chip
              key={`${kind}:${value}`} size="small" label={label} clickable
              onClick={() => setCohortFilter(active ? null : { kind, value })}
              sx={{
                ...sx,
                cursor: 'pointer',
                outline: active ? '2px solid #1565c0' : 'none',
                outlineOffset: 1,
              }}
            />
          );
        };

        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="h6" sx={{ mr: 1 }}>{cohort.total.toLocaleString()} leads</Typography>
              {['A', 'B', 'C', 'D', 'ungraded'].filter((g) => cohort.grades[g]).map((g) => chip(
                'grade', g, `${g}: ${cohort.grades[g].toLocaleString()}`,
                {
                  fontWeight: 600,
                  ...(g === 'A' ? { bgcolor: '#dcfce7', color: '#166534' }
                    : g === 'ungraded' ? { bgcolor: '#fff3d6', color: '#8a5a00' } : {}),
                },
              ))}
            </Stack>

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {Object.entries(cohort.statuses).sort((a, b) => b[1] - a[1]).map(([s, n]) => chip(
                'status', s, `${s}: ${n.toLocaleString()}`, { variant: 'outlined' },
              ))}
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            {/* The numbers that decide whether this cohort can be emailed at all. */}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {chip('trait', 'traced', `${cohort.traced.toLocaleString()} deep skip traced`)}
              {chip('trait', 'insuredEmail', `${cohort.insuredEmail.toLocaleString()} reachable by insured email`, {
                fontWeight: 600,
                ...(cohort.insuredEmail / cohort.total < 0.5
                  ? { bgcolor: '#fee2e2', color: '#b3261e' }
                  : { bgcolor: '#dcfce7', color: '#166534' }),
              })}
              {chip('trait', 'coInsuredEmail', `${cohort.coInsuredEmail.toLocaleString()} reachable by co-insured email`, {
                ...(cohort.coInsuredEmail ? { bgcolor: '#fff3d6', color: '#8a5a00' } : {}),
              })}
              {chip('trait', 'insuredPhone', `${cohort.insuredPhone.toLocaleString()} reachable by insured phone`)}
              {chip('trait', 'coInsuredPhone', `${cohort.coInsuredPhone.toLocaleString()} reachable by co-insured phone`, {
                ...(cohort.coInsuredPhone ? { bgcolor: '#fff3d6', color: '#8a5a00' } : {}),
              })}
              <Typography variant="caption" color="text.secondary">
                {Math.round((cohort.insuredEmail / cohort.total) * 100)}% of this cohort has an insured email address
                {' — campaigns mail the named insured only, so the co-insured counts are reach we hold but do not use.'}
              </Typography>
              {cohortFilter && (
                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600 }}>
                  · showing {shownRows.length.toLocaleString()} — click the chip again to clear
                </Typography>
              )}
            </Stack>
          </Paper>
        );
      })()}

      {reach && (() => {
        const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
        // Every chip filters the table. Clicking the active one clears it, so the way out
        // is the way in — no separate reset to hunt for.
        const slice = (key: typeof reachFilter, label: string, sx: Record<string, unknown> = {}) => (
          <Chip
            key={key} size="small" label={label} clickable
            onClick={() => setReachFilter(reachFilter === key ? 'all' : key)}
            sx={{
              ...sx, cursor: 'pointer',
              outline: reachFilter === key ? '2px solid #1565c0' : 'none', outlineOffset: 1,
            }}
          />
        );
        const combined = reach.insured + reach.coOnly;
        const unreachable = reach.total - combined;

        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
              <Typography variant="h6" sx={{ mr: 1 }}>{reach.total.toLocaleString()} leads</Typography>
              {slice('insured', `${reach.insured.toLocaleString()} reachable at the insured (${pct(reach.insured, reach.total)})`, {
                fontWeight: 600, bgcolor: '#dcfce7', color: '#166534',
              })}
              {slice('coOnly', `${reach.coOnly.toLocaleString()} only at the co-insured`, {
                fontWeight: 600, bgcolor: '#fff3d6', color: '#8a5a00',
              })}
              {slice('unreachable', `${unreachable.toLocaleString()} unreachable`, {
                bgcolor: '#fee2e2', color: '#b3261e',
              })}
              {reachFilter !== 'all' && (
                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600 }}>
                  · showing {shownRows.length.toLocaleString()} — click the chip again to clear
                </Typography>
              )}
            </Stack>

            {/* The point of the report: what the insured-only rule costs in reach. */}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Combined reach would be <strong>{combined.toLocaleString()}</strong> ({pct(combined, reach.total)}) if
              co-insured addresses were mailed — <strong>{reach.coOnly.toLocaleString()}</strong> households
              {' '}({pct(reach.coOnly, reach.total)}) are reachable no other way. Campaigns currently go to the named insured only.
            </Typography>

            <Divider sx={{ my: 1.5 }} />

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Renewal week</TableCell>
                    <TableCell align="right">Leads</TableCell>
                    <TableCell align="right">Insured</TableCell>
                    <TableCell align="right">Co-insured only</TableCell>
                    <TableCell align="right">Combined</TableCell>
                    <TableCell align="right">Reach</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reach.weeks.map((w) => {
                    const c = w.insured + w.coOnly;
                    return (
                      <TableRow key={w.cohort} hover>
                        <TableCell>{w.label}</TableCell>
                        <TableCell align="right">{w.total.toLocaleString()}</TableCell>
                        <TableCell align="right">{w.insured.toLocaleString()}</TableCell>
                        <TableCell align="right" sx={{ color: w.coOnly ? '#8a5a00' : 'inherit', fontWeight: w.coOnly ? 600 : 400 }}>
                          {w.coOnly.toLocaleString()}
                        </TableCell>
                        <TableCell align="right">{c.toLocaleString()}</TableCell>
                        <TableCell align="right">{pct(c, w.total)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        );
      })()}

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

      {/* Low balance is the one credit fact worth surfacing here: it changes whether
          the next blast can run at all. The per-lead cost does not. */}
      {report === 'blast_skiptrace' && credits?.known && credits.low && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>Tracerfy credits are low.</strong> About {credits.remaining?.toLocaleString()} left
          {credits.matchesRemaining != null ? ` — roughly ${credits.matchesRemaining.toLocaleString()} more matches` : ''}.
          {' '}Ask your manager to top up before the next blast.
        </Alert>
      )}

      {blastRuns && blastRuns.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            {blastRuns.length} blast run{blastRuns.length === 1 ? '' : 's'} · {rows.length} lead{rows.length === 1 ? '' : 's'} traced
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            What each run recovered. Leads that returned nothing are worth re-checking before they are written off.
          </Typography>
          <Stack spacing={1}>
            {blastRuns.map((run) => (
              <Stack
                key={run.runId}
                direction="row" spacing={1} useFlexGap
                sx={{ alignItems: 'center', flexWrap: 'wrap', py: 0.75, borderTop: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 92, fontVariantNumeric: 'tabular-nums' }}>{run.when}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 190 }}>{run.by}</Typography>
                <Chip size="small" label={`${run.leads} leads`} sx={{ height: 20, fontSize: 11 }} />
                <Chip size="small" label={`${run.hits} matched`} sx={{ height: 20, fontSize: 11, bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} />
                <Chip size="small" label={`${run.leads - run.hits} no match`} sx={{ height: 20, fontSize: 11 }} />
                <Typography variant="caption" color="text.secondary">
                  {run.phone} with phone · {run.email} with email
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        {loading ? <CircularProgress size={18} /> : <Typography variant="body2" color="text.secondary"><strong>{shownRows.length}</strong> record{shownRows.length === 1 ? '' : 's'}</Typography>}
      </Box>

      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {tableColumns.map((c) => (
                <TableCell key={c.header} align={c.numeric ? 'right' : 'left'} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {c.header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {shownRows.slice(0, MAX_RENDERED).map((r) => (
              <TableRow key={r.propertyId + r.context} hover>
                {tableColumns.map((c) => (
                  <TableCell
                    key={c.header}
                    align={c.numeric ? 'right' : 'left'}
                    sx={c.header === 'Detail'
                      ? { maxWidth: 380, fontSize: 12.5, color: '#3d4658' }
                      : { whiteSpace: 'nowrap', fontSize: 12.5 }}
                  >
                    {c.cell ? c.cell(r) : c.value(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {shownRows.length > MAX_RENDERED && (
              <TableRow>
                <TableCell colSpan={tableColumns.length} sx={{ textAlign: 'center', py: 2, color: '#8a5a00', bgcolor: '#fff8e8', fontSize: 12.5 }}>
                  Showing the first {MAX_RENDERED} of {shownRows.length.toLocaleString()} — Export CSV gives you all of them.
                </TableCell>
              </TableRow>
            )}
            {!loading && ran && shownRows.length === 0 && (
              <TableRow><TableCell colSpan={tableColumns.length} sx={{ textAlign: 'center', py: 4, color: '#888' }}>No records match.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Container>
  );
}
