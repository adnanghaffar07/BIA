'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { LOST_TARGET_PCT } from '@/lib/targets';
import { CATEGORY_LABEL, RECOVERABLE, type GradeChangeCategory } from '@/services/gradeChangeReason';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import DownloadIcon from '@mui/icons-material/Download';
import Link from 'next/link';
import { useStickyState } from '@/hooks/useStickyState';

/** One renewal week in the Cohort Ledger — mirrors CohortLedgerRow on the server. */
type LedgerRow = {
  cohort: string; label: string; total: number;
  aAtPull: number; downgraded: number; trough: number;
  /** Left Grade A and is Grade A again — a grade round trip, NOT the skip-trace count. */
  recovered: number;
  /** Isolated leads the skip trace found an insured email for. This is the skip-trace count. */
  emailRecovered: number;
  stillA: number; gainedOther: number; aNow: number; mailable: number;
  lost: number; lostPct: number | null; noPullRecord: number; unexplained: number;
  rated: number; unworkedGradeA: number;
  unworkedTopCounty: string | null; unworkedTopCountyShare: number | null;
};

type ReportType = 'cohort_ledger' | 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch' | 'owner_verify' | 'contact_coverage' | 'skiptrace_mismatch' | 'blast_skiptrace' | 'cohort' | 'reachability';


const REPORTS: { key: ReportType; label: string; icon: React.ReactNode; blurb: string }[] = [
  { key: 'cohort_ledger', label: 'Cohort Ledger', icon: <SwapVertIcon />, blurb: 'Per renewal week: how many Grade A the pull started with, how many were downgraded, how many came back, how many the skip trace found an email for, and how many we can actually mail — against the 5% loss target.' },
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

/**
 * The four stages of contact recovery, in the order a lead passes through them.
 *
 * "Recovered" is a stage rather than just an outcome because it is the number Frank and
 * Ruben actually want — how many came back — and a count nobody can click is a count
 * nobody trusts.
 */
const PIPELINE_STAGES = [
  { key: 'isolated'  as const, label: 'Not traced yet',      color: '#b3261e', blurb: 'Grade A, quote-ready, no insured email, and no deep trace has ever run. Tracerfy goes first.' },
  { key: 'tracerfy'  as const, label: 'Tracerfy found none', color: '#8a5a00', blurb: 'Tracerfy has run and returned no insured email. BatchData is next.' },
  { key: 'batchdata' as const, label: 'BatchData found none', color: '#5a6675', blurb: 'Both vendors have now run and neither found an insured email. Exhausted — nothing further to try.' },
  { key: 'recovered' as const, label: 'Recovered',           color: '#2e7d46', blurb: 'An address came back. The lead is re-graded and returned to the status it held before isolation.' },
];
/**
 * Most a single blast will call, whatever the pool.
 *
 * A ceiling exists so nobody can spend thousands of vendor calls with one click — not to
 * make ordinary work take several clicks. It was 25, which meant a pool of 29 had to be
 * run twice for the sake of four leads. Set where a normal week's backlog finishes in one
 * run and an accidental whole-book blast still does not.
 */
const MAX_PER_BLAST = 100;

type PipelineStage = (typeof PIPELINE_STAGES)[number]['key'];
type PipelineRow = {
  id: string; owner: string; city: string | null; zip: string | null;
  effectiveDate: string | null; grade: string | null; status: string | null;
  hasEmail: boolean; hasPhone: boolean; triedTracerfyAt: string | null; triedBatchDataAt: string | null;
  recoveredBy: string | null;
};

/**
 * How the twelve reports are grouped in the picker.
 *
 * Flat, twelve boxes wrapped onto two rows with an orphan on the end, every one the same
 * weight — there was nothing to tell you which report answered which question, so finding
 * the right one meant reading all of them. Grouped by the question they answer: how is a
 * cohort doing, are the grades right, is the data sound, can we reach anyone.
 *
 * Keys not listed here still render, under "Other" — a report added later must never
 * vanish from the page because someone forgot to file it.
 */
const REPORT_GROUPS: { label: string; keys: ReportType[] }[] = [
  { label: 'Cohort performance', keys: ['cohort_ledger', 'cohort', 'reachability'] },
  { label: 'Grading', keys: ['grade_overrides', 'roof_b'] },
  { label: 'Data quality', keys: ['type_mismatch', 'skiptrace_mismatch', 'owner_verify', 'contact_coverage'] },
  { label: 'Outreach', keys: ['referral', 'blast_skiptrace', 'keyword'] },
];

const gradeColor = (g: string | null) =>
  g === 'A' ? '#2e7d46' : g === 'B' ? '#c77a17' : g === 'C' ? '#c0522a' : '#6b7280';
const eligLabel = (v: string | null) => (v === 'review' ? 'Referral' : v === 'ineligible' ? 'Non-eligible' : v === 'eligible' ? 'Eligible' : '—');

const yn = (v: unknown) => (v ? 'Yes' : 'No');

/** Stored as 10 raw digits; shown the way a person would read one back. */
const fmtPhone = (p: string) => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(p ?? '');
};

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
    /**
     * The key every export was missing.
     *
     * Frank, 17 Sep 2026: "How do I know which co-insured links to which card? … It can't
     * be in chronological order because the numbers aren't the same." Two exports taken
     * with different filters could not be joined — there was no column common to both that
     * identified a property, only an owner name, and names are neither unique nor stable.
     *
     * First column on purpose: it is the one a VLOOKUP needs to find.
     */
    {
      header: 'Lead ID',
      value: (r) => r.propertyId,
      cell: (r) => (
        <Link href={`/leads/${r.propertyId}?from=qc`} style={{ color: '#6b7280', textDecoration: 'none', fontSize: 11, fontFamily: 'monospace' }}>
          {r.propertyId}
        </Link>
      ),
    },
    {
      header: 'Owner',
      value: (r) => r.owner,
      cell: (r) => (
        <Link href={`/leads/${r.propertyId}?from=qc`} style={{ color: '#1565c0', textDecoration: 'none' }}>{r.owner}</Link>
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
        /**
         * The addresses themselves, not Yes/No.
         *
         * A Yes told you the household was reachable but not at what, so checking one
         * homeowner — or handing the list to anyone — meant opening every card. A lead can
         * hold several insured addresses, so all of them are listed; an empty cell means
         * none, which reads the same as the old "No".
         */
        { header: 'Insured Email', value: (r) => (r.insuredEmailList ?? []).join(', ') },
        // The second email in the cadence goes to this person, so the export has to carry
        // who they are — an address with no name cannot be addressed.
        { header: 'Co-Insured Name', value: (r) => r.coInsuredName ?? '' },
        { header: 'Co-Insured Email', value: (r) => (r.coInsuredEmailList ?? []).join(', ') },
        { header: 'Insured Phone', value: (r) => (r.insuredPhoneList ?? []).map(fmtPhone).join(', ') },
        { header: 'Co-Insured Phone', value: (r) => (r.coInsuredPhoneList ?? []).map(fmtPhone).join(', ') },
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

  const all: QcColumn[] = [
    ...base,
    ...extras,
    { header: 'Detail', value: (r) => r.context },
    { header: 'By', value: (r) => r.by ?? '—' },
    { header: 'When', value: (r) => r.at ?? '—' },
  ];

  /**
   * Grade Changes: the date and the category belong at the FRONT.
   *
   * 'When' is the last of fourteen columns, past a Detail column wide enough to push it
   * off screen — which is why the tab looked as though it carried no date at all. The
   * category is what the list is read for, so it sits beside it rather than having to be
   * inferred from the free text in Detail.
   */
  if (report === 'grade_overrides') {
    const when = all.find((c) => c.header === 'When')!;
    const rest = all.filter((c) => c.header !== 'When');
    const at = rest.findIndex((c) => c.header === 'Eff Date') + 1;
    rest.splice(at, 0,
      { ...when, header: 'Changed On' },
      { header: 'Why', value: (r) => CATEGORY_LABEL[(r.changeCategory ?? 'other') as GradeChangeCategory] ?? '—' },
    );
    return rest;
  }

  return all;
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
  /**
   * Renewal Week drill-down. One active choice PER KIND, not one overall, so "Grade A"
   * and "reachable by insured email" narrow together — which is the question actually
   * being asked ("how many Grade A can we email?"), and was impossible when picking a
   * second chip silently replaced the first.
   */
  // Sticky, like the filters above: opening a lead and coming back should not silently
  // widen the view the producer was reading.
  const [cohortFilter, setCohortFilter] = useStickyState<{ grade?: string; status?: string; trait?: string }>('qc:cohortFilter', {});
  /** Reachability drill-down: which slice of the population the table is narrowed to. */
  const [reachFilter, setReachFilter] = useStickyState<'all' | 'insured' | 'coOnly' | 'unreachable'>('qc:reachFilter', 'all');
  const [covFilter, setCovFilter] = useStickyState<'all' | 'sfh' | 'condo' | 'both' | 'phoneOnly' | 'emailOnly' | 'neither' | 'noEmail' | 'hasDob'>('qc:covFilter', 'all');
  const [rows, setRows] = useState<QcRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  /** Grade Changes: which reason category the list is narrowed to (A33). */
  const [changeFilter, setChangeFilter] = useStickyState<string | null>('qc:changeFilter', null);

  /** Contact recovery run state — preview first, then an explicit paid run. */
  const [recovery, setRecovery] = useState<{ busy: boolean; preview: number | null; msg: string }>(
    { busy: false, preview: null, msg: '' },
  );


  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState(false);
  // Which report the rows in state actually came from. Switching reports keeps the
  // old rows on screen until the new fetch lands, so a summary computed from "rows"
  // would describe the previous report — the blast summary read 974 leads from the
  // Referrals list. Summaries render only once this matches.
  const [rowsReport, setRowsReport] = useState<ReportType | null>(null);

  /**
   * Restoring the view after a trip to a lead (Abdullah Sep-2026).
   *
   * The filters already survive in sessionStorage, but the RESULTS do not: coming back
   * put the producer on the right report with the right dates and an empty table asking
   * them to press Run again, on the pipeline's first stage rather than the one they had
   * open. The lead page sends them back with ?restore=1; that re-runs the report once,
   * after the sticky filters have hydrated, so the screen they left is the screen they
   * return to.
   */
  const [hydrated, setHydrated] = useState(false);
  const restoredRef = useRef(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // The ledger is one row per WEEK, not per lead, so it has its own endpoint and its
      // own shape — forcing it through QcRow would mean inventing a lead for each cohort.
      if (report === 'cohort_ledger') {
        const u = new URL('/api/admin/cohort-ledger', window.location.origin);
        if (effFrom) u.searchParams.set('effFrom', effFrom);
        if (effTo) u.searchParams.set('effTo', effTo);
        const r = await fetch(u.toString());
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'Report failed');
        setLedger(j.data || []);
        setRows([]);
        setRowsReport(report);
        setRan(true);
        return;
      }

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
      // The pipeline is part of this report, so it loads when the report does — with
      // whatever range the operator actually chose, and on the stage they were last
      // reading rather than always the first one.
      if (report === 'blast_skiptrace') void loadPipelineRef.current?.(stageRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed');
      setRows([]);
      setRowsReport(null);
    } finally {
      setLoading(false);
    }
  }, [report, carrier, value, setBy, q, effFrom, effTo]);

  /**
   * run() is defined above loadPipeline and needs to call it. A ref avoids reordering two
   * callbacks that each depend on the other's inputs.
   */
  const loadPipelineRef = useRef<((stage: PipelineStage) => Promise<void>) | null>(null);

  /**
   * The stage on screen, held in a ref as well as in state because run() needs to read it
   * without taking it as a dependency (that would re-create run on every tab click and
   * re-fire the effects that watch it). Mirrored into sessionStorage so it is still the
   * chosen stage after a trip to a lead and back.
   */
  const stageRef = useRef<PipelineStage>('isolated');

  /** Recovery pipeline: which stage is on screen, its rows, and the stage totals. */
  const [pipeline, setPipeline] = useState<{
    stage: PipelineStage; rows: PipelineRow[];
    counts: Record<string, number> | null; busy: boolean; msg: string;
    /**
     * Set when a run ended itself — out of credits, a rejected key, or a vendor failing
     * on every call. Held apart from `msg` because it is a different kind of statement:
     * msg reports what a run did, this reports why it did not finish.
     */
    stopped?: { reason: 'no_credits' | 'auth' | 'vendor_error'; vendor: string; detail: string; remaining: number } | null;
  }>({ stage: 'isolated', rows: [], counts: null, busy: false, msg: '', stopped: null });

  const loadPipeline = useCallback(async (stage: PipelineStage) => {
    stageRef.current = stage;
    try { sessionStorage.setItem('qc:pipeStage', stage); } catch { /* blocked storage is not worth failing over */ }
    setPipeline((p) => ({ ...p, busy: true, stage }));
    try {
      const u = new URL('/api/admin/recovery-pipeline', window.location.origin);
      if (effFrom) u.searchParams.set('effFrom', effFrom);
      if (effTo) u.searchParams.set('effTo', effTo);
      u.searchParams.set('stage', stage);
      const j = await (await fetch(u.toString())).json();
      if (!j.success) throw new Error(j.error || 'Could not read the pipeline');
      setPipeline((p) => ({ ...p, stage, rows: j.data || [], counts: j.counts, busy: false }));
    } catch (e) {
      setPipeline((p) => ({ ...p, busy: false, msg: e instanceof Error ? e.message : 'Failed' }));
    }
  }, [effFrom, effTo]);
  loadPipelineRef.current = loadPipeline;

  // Declared after the useStickyState calls above, so by the time this commits they have
  // already queued their restored values and the next render carries both.
  useEffect(() => {
    try {
      const st = sessionStorage.getItem('qc:pipeStage');
      if (st && PIPELINE_STAGES.some((s) => s.key === st)) {
        stageRef.current = st as PipelineStage;
        setPipeline((p) => ({ ...p, stage: st as PipelineStage }));
      }
    } catch { /* ignore blocked storage */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || restoredRef.current) return;
    restoredRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('restore') !== '1') return;
    // Drop the marker so a manual reload of this URL is an ordinary visit.
    window.history.replaceState(null, '', '/admin/qc');
    void run();
    restoreScrollRef.current = true;
  }, [hydrated, run]);

  /** Set when a restore is in flight, so the pipeline panel can be scrolled back into view. */
  const restoreScrollRef = useRef(false);
  const pipelineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!restoreScrollRef.current || loading || !pipelineRef.current) return;
    restoreScrollRef.current = false;
    pipelineRef.current.scrollIntoView({ block: 'start' });
  }, [loading, rowsReport]);

  const runPipelineBlast = useCallback(async (vendor: 'tracerfy' | 'batchdata', dryRun: boolean) => {
    setPipeline((p) => ({ ...p, busy: true, msg: '', stopped: null }));
    try {
      const j = await (await fetch('/api/admin/recovery-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor, effFrom, effTo, dryRun, limit: MAX_PER_BLAST }),
      })).json();
      if (!j.success) throw new Error(j.error || 'Blast failed');
      const name = vendor === 'tracerfy' ? 'Tracerfy' : 'BatchData';
      setPipeline((p) => ({
        ...p, busy: false, counts: j.counts, stopped: j.stopped ?? null,
        msg: `${name}: tried ${j.attempted}, matched ${j.matched}, `
          + `recovered ${j.recovered}`
          + (j.phoneOnly ? `, ${j.phoneOnly} gained a phone but no email` : '')
          + `, ${j.movedOn} moved on`,
      }));
      await loadPipeline(vendor === 'tracerfy' ? 'isolated' : 'tracerfy');
    } catch (e) {
      setPipeline((p) => ({ ...p, busy: false, stopped: null, msg: e instanceof Error ? e.message : 'Blast failed' }));
    }
  }, [effFrom, effTo, loadPipeline]);

  /**
   * Cleared when the tab or the dates change — never auto-loaded.
   *
   * It used to load itself the moment the tab opened, which meant that with the date
   * boxes empty it quietly scoped to the ENTIRE book and offered a paid blast against it.
   * Every isolated lead happens to come from one week, so "31" looked like that week's
   * number and was really all of them. Every other report on this page waits for Run;
   * this one has no business being the exception, least of all the one that spends money.
   */
  useEffect(() => {
    setPipeline((p) => ({ ...p, rows: [], counts: null, msg: '' }));
  }, [report, effFrom, effTo]);

  /**
   * Clear the result banners when the thing they described is no longer on screen.
   *
   * "Isolated 0." sat under a filter it had nothing to do with, minutes after the run that
   * produced it, reading as a statement about whatever the operator was looking at now. A
   * result is about the moment it was produced; once the tab, the dates or the filter move,
   * it is describing something the reader can no longer see, and a stale number on a screen
   * people are learning to trust is worse than no number.
   */
  useEffect(() => {
    setIsolateState((r) => ({ ...r, preview: null, msg: '' }));
    setRecovery((r) => ({ ...r, preview: null, msg: '' }));
  }, [report, effFrom, effTo, cohortFilter, changeFilter]);

  /**
   * What the run will cover, said in the operator's own terms.
   *
   * "181 leads" next to a table showing six is the kind of mismatch that makes a number
   * untrustworthy even when both are correct, so the scope is named rather than implied.
   */
  const scopeLabel = effFrom || effTo
    ? `${effFrom || 'the start'} – ${effTo || 'today'}`
    : 'the whole book';

  /** Isolate run state — preview, then apply. */
  const [isolateState, setIsolateState] = useState<{ busy: boolean; preview: number | null; msg: string }>(
    { busy: false, preview: null, msg: '' },
  );

  const runIsolate = useCallback(async (dryRun: boolean) => {
    setIsolateState((r) => ({ ...r, busy: true, msg: '' }));
    try {
      const res = await fetch('/api/admin/isolate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, effFrom, effTo }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Isolate failed');
      const was = Object.entries(j.fromStatus || {})
        .map(([k, v]) => `${v} ${k}`).join(', ');
      if (dryRun) {
        setIsolateState({
          busy: false,
          preview: j.candidates,
          msg: j.candidates
            ? `${j.candidates} would be isolated (currently ${was || 'unset'}). Their status is remembered and restored if an email turns up.`
              + (j.restored ? ` ${j.restored} already-isolated lead(s) are now reachable and would be put back.` : '')
            : 'Nothing to isolate in this range.',
        });
      } else {
        setIsolateState({
          busy: false, preview: null,
          msg: `Isolated ${j.isolated}${j.restored ? `, restored ${j.restored}` : ''}.`,
        });
        await run();
      }
    } catch (e) {
      setIsolateState({ busy: false, preview: null, msg: e instanceof Error ? e.message : 'Isolate failed' });
    }
  }, [run, effFrom, effTo]);

  const runRecovery = useCallback(async (dryRun: boolean) => {
    setRecovery((r) => ({ ...r, busy: true, msg: '' }));
    try {
      const res = await fetch('/api/admin/contact-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The run must cover exactly the range on screen — not the whole book.
        body: JSON.stringify({ dryRun, limit: 25, effFrom, effTo }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Recovery failed');
      if (dryRun) {
        setRecovery({
          busy: false,
          preview: j.candidates,
          msg: `${j.candidates} lead${j.candidates === 1 ? '' : 's'} in ${scopeLabel} are still unreachable and were downgraded for it`
            + `${j.stillNoDob ? `, and ${j.stillNoDob} of the next ${Math.min(j.candidates, 25)} also have no DOB, which BatchData cannot supply` : ''}.`,
        });
      } else {
        setRecovery({
          busy: false,
          preview: null,
          msg: `Ran on ${j.attempted}: ${j.matched} matched, ${j.recoveredEmail} gained an email, `
            + `${j.recoveredPhone} gained a phone, ${j.regraded} re-graded, `
            + `${j.needsReview} still under a manual grade and needing review`
            + (j.errors?.length ? ` · stopped early: ${j.errors[0].error}` : ''),
        });
        await run();
      }
    } catch (e) {
      setRecovery({ busy: false, preview: null, msg: e instanceof Error ? e.message : 'Recovery failed' });
    }
  }, [run, effFrom, effTo, scopeLabel]);

  // Auto-run on report switch (except keyword, which waits for a term).
  useEffect(() => {
    setCovFilter('all'); // reset the coverage drill-down on report change
    setCohortFilter({});
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
      const { grade, status, trait } = cohortFilter;
      if (!grade && !status && !trait) return rows;
      const traitOf = (r: QcRow) => ({
        traced: !!r.matched,
        insuredEmail: !!r.hasInsuredEmail,
        coInsuredEmail: !!r.hasCoInsuredEmail,
        insuredPhone: !!r.hasInsuredPhone,
        coInsuredPhone: !!r.hasCoInsuredPhone,
        // The gap, not the coverage. Everything else here counts what we CAN reach;
        // this is the work list — who is eligible to be mailed and has no address to
        // mail. It is the number the re-trace decision is made on.
        noInsuredEmail: !r.hasInsuredEmail,
        /**
         * Already deep traced and STILL has no insured address.
         *
         * Re-running the same tool on these returns the same nothing. They are the only
         * leads a second provider could add anything to, and separating them is what
         * stops the next blast paying to re-trace leads that were never traced at all.
         */
        tracedStillNoEmail: !!r.matched && !r.hasInsuredEmail,
      } as Record<string, boolean>);
      return rows.filter((r) => {
        if (grade && (r.manualGrade || r.grade || 'ungraded') !== grade) return false;
        if (status && (r.reason || '(none)') !== status) return false;
        if (trait && !traitOf(r)[trait]) return false;
        return true;
      });
    }
    if (report === 'grade_overrides') {
      return changeFilter ? rows.filter((r) => (r.changeCategory ?? 'other') === changeFilter) : rows;
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
  }, [rows, report, covFilter, cohortFilter, reachFilter, changeFilter]);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>QC / Data Validation</Typography>
        <Typography variant="body1" color="text.secondary">
          Pull producer notes, variance notes, eligibility &amp; grade overrides back out — spot trends without leaving the CRM.
        </Typography>
      </Box>

      {(() => {
        const grouped = new Set(REPORT_GROUPS.flatMap((g) => g.keys));
        const ungrouped = REPORTS.filter((r) => !grouped.has(r.key));
        const groups = ungrouped.length
          ? [...REPORT_GROUPS, { label: 'Other', keys: ungrouped.map((r) => r.key) }]
          : REPORT_GROUPS;
        return (
          <Box sx={{ mb: 2.5, display: 'flex', flexWrap: 'wrap', gap: { xs: 2, md: 3 }, rowGap: 2 }}>
            {groups.map((g) => (
              <Box key={g.label}>
                <Typography
                  sx={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                    textTransform: 'uppercase', color: '#8a93a3', mb: 0.75,
                  }}
                >
                  {g.label}
                </Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {g.keys.map((k) => {
                    const r = REPORTS.find((x) => x.key === k);
                    if (!r) return null;
                    const on = report === r.key;
                    return (
                      <Button
                        key={r.key}
                        onClick={() => setReport(r.key)}
                        size="small"
                        startIcon={r.icon}
                        disableElevation
                        sx={{
                          textTransform: 'none',
                          fontSize: 12.5,
                          fontWeight: on ? 700 : 500,
                          px: 1.25, py: 0.5,
                          borderRadius: 1.5,
                          whiteSpace: 'nowrap',
                          border: '1px solid',
                          // The selected report is the one thing on this row that must be
                          // unmistakable; everything else recedes.
                          bgcolor: on ? '#1f5f8b' : '#fff',
                          color: on ? '#fff' : '#3d4658',
                          borderColor: on ? '#1f5f8b' : '#dfe3e8',
                          '& .MuiButton-startIcon': { mr: 0.6, '& svg': { fontSize: 17 } },
                          '&:hover': {
                            bgcolor: on ? '#18506f' : '#f2f6fa',
                            borderColor: on ? '#18506f' : '#c4cdd8',
                          },
                        }}
                      >
                        {r.label}
                      </Button>
                    );
                  })}
                </Stack>
              </Box>
            ))}
          </Box>
        );
      })()}

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

      {report === 'cohort_ledger' && rowsReport === 'cohort_ledger' && (
        <Paper variant="outlined" sx={{ mb: 2, overflowX: 'auto' }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {/*
                  Two different recoveries, named apart.

                  One column called "Recovered" read as "what the skip trace bought" and
                  answered with a grade round trip: it said 1 for the Oct 5 week while the
                  pipeline had found insured emails for 11 leads in that same week. Both
                  numbers were right and neither was the one being asked for. A lead that
                  is Grade A and unmailable never left Grade A, so finding it an address
                  moves Mailable and leaves the grade columns alone.
                */}
                {['Renewal week', 'Leads', 'Grade A at pull', 'Downgraded', 'Low point',
                  'Regained A', 'Grade A now', 'Email found', 'Mailable', 'Unworked A', 'Lost', 'Lost %'].map((h, i) => (
                  <TableCell key={h} align={i > 1 ? 'right' : 'left'}
                    sx={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {ledger.map((d) => {
                // The target is the whole point of the column, so it is coloured rather
                // than left for the reader to compare against a number in a blurb.
                const over = d.lostPct != null && d.lostPct > LOST_TARGET_PCT;
                return (
                  <TableRow key={d.cohort} hover>
                    <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap', fontWeight: 600 }}>{d.label}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{d.total.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700 }}>{d.aAtPull.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, color: d.downgraded ? '#b3261e' : 'inherit' }}>
                      {d.downgraded ? `−${d.downgraded}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>{d.trough.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, color: d.recovered ? '#166534' : 'inherit', fontWeight: d.recovered ? 700 : 400 }}>
                      <Tooltip arrow title={
                        d.recovered
                          ? `${d.recovered} lead${d.recovered === 1 ? '' : 's'} left Grade A and ${d.recovered === 1 ? 'is' : 'are'} Grade A again — a grade round trip. This is NOT the skip trace count; see "Email found".`
                          : 'Nothing that left Grade A has come back to it. Contact recovery is counted under "Email found".'
                      }>
                        <span style={{ cursor: 'help' }}>{d.recovered ? `+${d.recovered}` : '—'}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700 }}>
                      {d.aNow.toLocaleString()}
                      {d.gainedOther ? <Typography component="span" variant="caption" sx={{ color: '#166534', ml: 0.5 }}>+{d.gainedOther}↑</Typography> : null}
                    </TableCell>
                    {/*
                      What the skip trace actually bought.

                      Sits beside Mailable because it is the number that moves it: every
                      one of these is a Grade A lead that could not be emailed and now can.
                    */}
                    <TableCell align="right" sx={{ fontSize: 12, color: d.emailRecovered ? '#166534' : 'inherit', fontWeight: d.emailRecovered ? 700 : 400 }}>
                      <Tooltip arrow title={
                        d.emailRecovered
                          ? `Tracerfy or BatchData found an insured email for ${d.emailRecovered} isolated lead${d.emailRecovered === 1 ? '' : 's'} in this week. They were Grade A throughout — unmailable, not downgraded — so this shows up in Mailable rather than in the grade columns.`
                          : 'No isolated lead in this week has had an insured email found for it yet.'
                      }>
                        <span style={{ cursor: 'help' }}>{d.emailRecovered ? `+${d.emailRecovered}` : '—'}</span>
                      </Tooltip>
                    </TableCell>
                    {/*
                      Reach, not eligibility.
                      
                      "Grade A now" says how many are quote-ready; this says how many can
                      actually be emailed. On the Oct 12 week those are 87 and 46. Shown
                      next to each other so the gap cannot be read past, and coloured when
                      it is wide — a week can look like its best on the loss column while
                      barely half of it is contactable.
                    */}
                    {(() => {
                      const share = d.aNow ? d.mailable / d.aNow : 1;
                      return (
                        <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700, color: share < 0.8 ? '#8a5a00' : '#166534' }}>
                          <Tooltip arrow title={
                            d.aNow
                              ? `${d.mailable} of ${d.aNow} Grade A leads have an insured email — ${Math.round(share * 100)}%. The rest are quote-ready and unmailable.`
                              : 'No Grade A leads in this week.'
                          }>
                            <span style={{ cursor: 'help' }}>
                              {d.mailable.toLocaleString()}
                              {d.aNow > 0 && d.mailable < d.aNow && (
                                <Typography component="span" variant="caption" sx={{ color: '#8a5a00', ml: 0.75, fontWeight: 400 }}>
                                  {`· ${Math.round(share * 100)}%`}
                                </Typography>
                              )}
                            </span>
                          </Tooltip>
                        </TableCell>
                      );
                    })()}
                    {/*
                      Grade A leads nobody has put in front of a producer. Amber rather
                      than red: they are not lost, they are unseen — and a rated lead
                      gets an indicative price in email 2 while these cannot.
                    */}
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: d.unworkedGradeA ? 700 : 400, color: d.unworkedGradeA ? '#8a5a00' : 'inherit' }}>
                      {d.rated === 0
                        ? <Tooltip arrow title="This week has not been worked yet"><span style={{ color: '#9098a6' }}>—</span></Tooltip>
                        : d.unworkedGradeA
                          ? <Tooltip arrow title={
                              d.unworkedTopCounty
                                ? `${d.unworkedGradeA} Grade A still unrated — ${d.unworkedTopCountyShare}% of them in ${d.unworkedTopCounty}. ${d.rated} leads in this week have been rated, so these were available and never surfaced.`
                                : `${d.unworkedGradeA} Grade A still unrated, spread across counties. ${d.rated} leads in this week have been rated.`
                            }>
                              <span style={{ cursor: 'help' }}>{d.unworkedGradeA.toLocaleString()}</span>
                            </Tooltip>
                          : '0'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 12 }}>{d.lost.toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontSize: 12, fontWeight: 700, color: over ? '#b3261e' : '#166534' }}>
                      {d.lostPct == null ? '—' : `${d.lostPct}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Box sx={{ p: 1.5, borderTop: '1px solid #e6e8eb' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Grade A at pull → downgraded → low point → regained Grade A → Grade A now →
              <b> mailable</b> (of those, how many have an insured email).
              Target is a loss of {LOST_TARGET_PCT}% or less. <b>↑</b> marks leads that were not Grade A at
              pull and are now.
            </Typography>
            {/*
              Frank names a window inclusively — "10/26 to 11/02" — which is eight days and
              ends on the NEXT week's Monday. Renewal Week honours that literally; this tab
              counts whole weeks. Both are right and they do not match, so the difference is
              stated here rather than left to be discovered by comparing two screens.
            */}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Rows are whole renewal weeks (Monday–Sunday). A date range is widened to the
              weeks it touches, so these totals will not match a Renewal Week range that
              starts or ends mid-week — that tab counts the exact dates you type.
            </Typography>
            {/*
              Named, not just counted. A number in a column says a week has a problem; the
              county says where to look, and that is the difference between "19 leads were
              missed" and "the Middlesex leads were never surfaced to anyone".
            */}
            {ledger.some((d) => d.rated > 0 && d.unworkedTopCounty) && (
              <Typography variant="caption" sx={{ color: '#8a5a00', display: 'block', mt: 0.5 }}>
                Unworked Grade A concentrated in one county:{' '}
                {ledger
                  .filter((d) => d.rated > 0 && d.unworkedTopCounty)
                  .map((d) => `${d.label} — ${d.unworkedTopCountyShare}% in ${d.unworkedTopCounty}`)
                  .join('; ')}
                . These weeks have been worked, so those leads were available and never put in front of a producer.
              </Typography>
            )}
            {ledger.some((d) => d.noPullRecord || d.unexplained) && (
              <Typography variant="caption" sx={{ color: '#8a5a00', display: 'block', mt: 0.5 }}>
                Measurement gaps:{' '}
                {ledger.filter((d) => d.noPullRecord).map((d) => `${d.label} — ${d.noPullRecord} leads with no recorded starting grade`).join('; ')}
                {ledger.some((d) => d.noPullRecord) && ledger.some((d) => d.unexplained) ? '; ' : ''}
                {ledger.filter((d) => d.unexplained).map((d) => `${d.label} — ${d.unexplained} left Grade A with no logged reason`).join('; ')}
              </Typography>
            )}
          </Box>
        </Paper>
      )}

      {report === 'grade_overrides' && rowsReport === 'grade_overrides' && rows.length > 0 && (() => {
        const counts = new Map<string, number>();
        for (const r of rows) {
          const k = r.changeCategory ?? 'other';
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        const order = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        return (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="subtitle2" sx={{ mr: 1 }}>Why the grade changed</Typography>
              {order.map(([key, n]) => {
                const active = changeFilter === key;
                // The recoverable bucket is coloured apart from the rest: it is the only
                // one where running a better trace changes the answer, so it is the only
                // one worth spending credits on.
                const recoverable = key === RECOVERABLE;
                return (
                  <Chip
                    key={key} size="small" clickable
                    label={`${CATEGORY_LABEL[key as GradeChangeCategory] ?? key}: ${n.toLocaleString()}`}
                    onClick={() => setChangeFilter(active ? null : key)}
                    sx={{
                      fontWeight: recoverable ? 700 : 500,
                      ...(recoverable
                        ? { bgcolor: '#1565c0', color: '#fff', '&:hover': { bgcolor: '#0d47a1' } }
                        : { variant: 'outlined' }),
                      outline: active ? '2px solid #0d47a1' : 'none',
                      outlineOffset: 1,
                    }}
                  />
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Only <b>{CATEGORY_LABEL[RECOVERABLE]}</b> can be reversed by re-tracing — a lead under a trust
              or outside carrier appetite stays down however good the trace is. Filter to that chip before
              batching a re-trace.
              {changeFilter && <> · showing {shownRows.length.toLocaleString()} — click the chip again to clear</>}
            </Typography>
            {/*
              These chips count CHANGES, and a lead can be re-graded more than once. The
              recovery panel below counts LEADS, so the two legitimately differ — said
              here rather than left to look like an error, which is how the 521-vs-518
              mismatch was read before anyone checked it.
            */}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Counts are grade changes, not leads — a lead re-graded twice appears twice.
            </Typography>

            {/*
              The action that follows from the filter, offered where the filter is.

              Tracerfy has already run on these and returned nothing, so this calls
              BatchData directly rather than paying for a Tracerfy hit first. It is
              capped and previewed on purpose: the last mass operation run without a
              preview is still being unpicked.
            */}
            {changeFilter === RECOVERABLE && (
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #e6e8eb' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                  <Button
                    size="small" variant="contained"
                    startIcon={recovery.busy ? <CircularProgress size={14} color="inherit" /> : <ContactPhoneIcon />}
                    onClick={() => runRecovery(true)}
                    disabled={recovery.busy}
                  >
                    {recovery.busy ? 'Working…' : 'Preview contact recovery'}
                  </Button>
                  {/*
                    The count comes from the preview, which was itself scoped to the
                    dates on screen — so the button says how many leads it will really
                    call for, not a fixed cap that may exceed the whole filtered set.
                  */}
                  {recovery.preview != null && recovery.preview > 0 && (
                    <Button
                      size="small" variant="outlined" color="warning"
                      onClick={() => runRecovery(false)}
                      disabled={recovery.busy}
                    >
                      Run on {Math.min(recovery.preview, 25)} of {recovery.preview} — costs money
                    </Button>
                  )}
                  {recovery.preview === 0 && (
                    <Typography variant="caption" sx={{ color: '#166534' }}>
                      Nothing to recover in this range.
                    </Typography>
                  )}
                </Stack>
                {recovery.msg && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#3d4658' }}>
                    {recovery.msg}
                  </Typography>
                )}
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#8a5a00' }}>
                  BatchData returns phones and emails but <b>no date of birth</b> — a lead downgraded only
                  for a missing DOB is not fixed by this. Leads under a producer&apos;s manual grade keep it
                  and are reported for review rather than re-graded automatically.
                </Typography>
              </Box>
            )}
          </Paper>
        );
      })()}

      {cohort && (() => {
        // Every chip is a filter. Clicking the active one clears it, so there is no
        // separate "reset" to hunt for — the way out is the way in.
        const chip = (
          kind: 'grade' | 'status' | 'trait',
          value: string,
          label: string,
          sx: Record<string, unknown> = {},
        ) => {
          const active = cohortFilter[kind] === value;
          return (
            <Chip
              key={`${kind}:${value}`} size="small" label={label} clickable
              onClick={() => setCohortFilter((f) => ({ ...f, [kind]: active ? undefined : value }))}
              sx={{
                ...sx,
                cursor: 'pointer',
                outline: active ? '2px solid #1565c0' : 'none',
                outlineOffset: 1,
              }}
            />
          );
        };

        /**
         * The one combination that decides whether a cohort can be mailed this week.
         *
         * Grade A is the eligibility gate and an insured address is the delivery gate;
         * either number on its own overstates the list. Stacking the two chips gives the
         * same answer, but nobody reads a chip row as an AND — so this states it outright.
         */
        const isGradeA = (r: QcRow) => (r.manualGrade || r.grade || 'ungraded') === 'A';
        const aInsEmail = rows.filter((r) => r.hasInsuredEmail && isGradeA(r)).length;
        const aInsActive = cohortFilter.grade === 'A' && cohortFilter.trait === 'insuredEmail';

        // The other half of the same question: eligible to mail, nothing to mail to.
        const aNoEmail = rows.filter((r) => !r.hasInsuredEmail && isGradeA(r)).length;
        /**
         * How many of them are ACTUALLY isolated.
         *
         * The chip used to read "(Isolated)" for every lead it counted. Across the book
         * that is 22 leads out of 1,133 — the label was true only in the single week the
         * isolate action had been run on, and read as a statement of fact everywhere
         * else. A chip that asserts a status it has not checked is how a screen stops
         * being worth believing, so it now reports the split instead.
         */
        const aNoEmailIsolated = rows.filter(
          (r) => !r.hasInsuredEmail && isGradeA(r) && r.reason === 'isolated',
        ).length;
        /**
         * What isolating would overwrite, computed from the rows already on screen.
         *
         * This is the only thing the old two-step preview told anyone that the chip did
         * not — and it cost a round trip and an extra click to say it. Isolation is free
         * and reversible, so a preview earns nothing here; the pattern was copied from the
         * operations that spend money, where it does.
         */
        const aNoEmailByStatus = rows
          .filter((r) => !r.hasInsuredEmail && isGradeA(r) && r.reason !== 'isolated')
          .reduce<Record<string, number>>((acc, r) => {
            const k = r.reason || 'new';
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          }, {});
        const toIsolate = Object.values(aNoEmailByStatus).reduce((t, n) => t + n, 0);
        const breakdown = Object.entries(aNoEmailByStatus)
          .sort((x, y) => y[1] - x[1])
          .map(([k, n]) => `${n} ${k}`)
          .join(' · ');

        const isolationLabel = aNoEmail === 0
          ? ''
          : aNoEmailIsolated === aNoEmail ? ' (all isolated)'
            : aNoEmailIsolated === 0 ? ' (none isolated yet)'
              : ` (${aNoEmailIsolated} isolated)`;
        const aNoEmailActive = cohortFilter.grade === 'A' && cohortFilter.trait === 'noInsuredEmail';

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
              {chip('trait', 'traced', `${cohort.traced.toLocaleString()} deep skip traced — all grades`)}
              {chip('trait', 'tracedStillNoEmail',
                `${rows.filter((r) => r.matched && !r.hasInsuredEmail).length.toLocaleString()} traced but still no insured email — all grades`,
                { bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 })}
              {chip('trait', 'insuredEmail', `${cohort.insuredEmail.toLocaleString()} have an insured email — all grades`, {
                fontWeight: 600,
                ...(cohort.insuredEmail / cohort.total < 0.5
                  ? { bgcolor: '#fee2e2', color: '#b3261e' }
                  : { bgcolor: '#dcfce7', color: '#166534' }),
              })}
              <Chip
                size="small" clickable
                label={`${aInsEmail.toLocaleString()} have an insured email — Grade A only`}
                onClick={() => setCohortFilter((f) => (aInsActive
                  ? { ...f, grade: undefined, trait: undefined }
                  : { ...f, grade: 'A', trait: 'insuredEmail' }))}
                sx={{
                  fontWeight: 700,
                  bgcolor: '#1565c0',
                  color: '#fff',
                  '&:hover': { bgcolor: '#0d47a1' },
                  outline: aInsActive ? '2px solid #0d47a1' : 'none',
                  outlineOffset: 1,
                }}
              />
              <Chip
                size="small" clickable
                label={`${aNoEmail.toLocaleString()} missing an insured email — Grade A only${isolationLabel}`}
                onClick={() => setCohortFilter((f) => (aNoEmailActive
                  ? { ...f, grade: undefined, trait: undefined }
                  : { ...f, grade: 'A', trait: 'noInsuredEmail' }))}
                sx={{
                  fontWeight: 700,
                  bgcolor: aNoEmail ? '#b3261e' : '#e6e8eb',
                  color: aNoEmail ? '#fff' : '#3d4658',
                  '&:hover': { bgcolor: aNoEmail ? '#8c1d18' : '#d6d9dd' },
                  outline: aNoEmailActive ? '2px solid #8c1d18' : 'none',
                  outlineOffset: 1,
                }}
              />
              {chip('trait', 'coInsuredEmail', `${cohort.coInsuredEmail.toLocaleString()} have a co-insured email — all grades`, {
                ...(cohort.coInsuredEmail ? { bgcolor: '#fff3d6', color: '#8a5a00' } : {}),
              })}
              {chip('trait', 'insuredPhone', `${cohort.insuredPhone.toLocaleString()} have an insured phone — all grades`)}
              {chip('trait', 'coInsuredPhone', `${cohort.coInsuredPhone.toLocaleString()} have a co-insured phone — all grades`, {
                ...(cohort.coInsuredPhone ? { bgcolor: '#fff3d6', color: '#8a5a00' } : {}),
              })}
              {/*
                The action the chip beside it implies.

                Isolating parks a lead as unreachable while REMEMBERING the status it had
                — most of these are already rated, and the email cadence depends on that
                distinction, so overwriting it would cost more than it tidied.
              */}
              {cohortFilter.grade === 'A' && cohortFilter.trait === 'noInsuredEmail' && toIsolate > 0 && (
                <Button
                  size="small" variant="outlined" color="warning"
                  onClick={() => {
                    // One click, one question. The breakdown is the thing worth pausing
                    // over — isolating a RATED lead changes which email copy it receives.
                    if (confirm(
                      `Isolate ${toIsolate} Grade A lead${toIsolate === 1 ? '' : 's'} with no insured email?

`
                      + `Currently: ${breakdown}.

`
                      + 'Their current status is remembered and restored automatically if an address turns up. '
                      + 'Nothing is sent and no vendor is called.',
                    )) runIsolate(false);
                  }}
                  disabled={isolateState.busy}
                  sx={{ ml: 0.5 }}
                >
                  {isolateState.busy ? 'Working…' : `Isolate ${toIsolate} (${breakdown})`}
                </Button>
              )}
              <Typography variant="caption" color="text.secondary">
                {Math.round((cohort.insuredEmail / cohort.total) * 100)}% of this cohort has an insured email address
                {' — campaigns mail the named insured only, so the co-insured counts are reach we hold but do not use.'}
              </Typography>
              {(cohortFilter.grade || cohortFilter.status || cohortFilter.trait) && (
                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600 }}>
                  · showing {shownRows.length.toLocaleString()} — click the chip again to clear
                </Typography>
              )}
              {isolateState.msg && (
                <Typography variant="caption" sx={{ color: '#8a5a00', display: 'block', width: '100%', mt: 0.5 }}>
                  {isolateState.msg}
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

      {/*
        The recovery pipeline: isolated → Tracerfy → BatchData → recovered.

        Four stages rather than the three tools, because "came back" is a population
        people need to count, not just an outcome. Each stage is read from the lead's own
        recorded stage, so the tab totals and the QC filters cannot disagree.
      */}
      {report === 'blast_skiptrace' && (
        <Paper ref={pipelineRef} variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {/*
              The range is named, not implied. With the date boxes empty this covers the
              whole book, and a number that does not say what it counts is how "31" got
              read as one week's leads when it was every isolated lead there is.
            */}
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 1 }}>
              Contact recovery pipeline
              <Box component="span" sx={{ fontWeight: 400, color: '#5a6675', ml: 0.75 }}>
                — {effFrom || effTo ? `${effFrom || 'start'} to ${effTo || 'today'}` : 'all dates'}
              </Box>
            </Typography>
            {PIPELINE_STAGES.map((st) => {
              const n = pipeline.counts?.[st.key] ?? 0;
              const active = pipeline.stage === st.key;
              return (
                <Chip
                  key={st.key} size="small" clickable
                  label={`${st.label}: ${n.toLocaleString()}`}
                  onClick={() => loadPipeline(st.key)}
                  sx={{
                    fontWeight: active ? 700 : 500,
                    bgcolor: active ? st.color : '#f1f3f5',
                    color: active ? '#fff' : '#3d4658',
                    '&:hover': { bgcolor: active ? st.color : '#e3e6ea' },
                  }}
                />
              );
            })}
            <Button size="small" onClick={() => loadPipeline(pipeline.stage)} disabled={pipeline.busy}>
              {pipeline.busy ? 'Loading…' : 'Refresh'}
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {PIPELINE_STAGES.find((s) => s.key === pipeline.stage)?.blurb}
            {' '}Recovery means an insured <b>email</b> — that is what isolation is. A lead that gains only a
            phone keeps the phone and stays in the pipeline.
          </Typography>

          {/*
            Which vendor actually earned its money.

            The stage chips say where leads ARE; they never said who got them out, so
            "Recovered: 1" could not answer the only question that decides whether a second
            vendor is worth paying for. Both figures are already recorded per lead.
          */}
          {!!pipeline.counts && (pipeline.counts.recovered > 0 || pipeline.counts.phoneOnly > 0) && (
            <Typography variant="caption" sx={{ display: 'block', mb: 1, color: '#166534' }}>
              Recovered by — <b>Tracerfy {pipeline.counts.recoveredByTracerfy ?? 0}</b>
              {' · '}<b>BatchData {pipeline.counts.recoveredByBatchData ?? 0}</b>
              {!!pipeline.counts.phoneOnly && (
                <Box component="span" sx={{ color: '#8a5a00' }}>
                  {'  ·  '}{pipeline.counts.phoneOnly} gained a phone but no email — still unmailable, still in the pipeline
                </Box>
              )}
            </Typography>
          )}

          {/* Only the two vendor stages can be blasted; the others are outcomes. */}
          {/*
            Leads that belong in this pipeline and have not been put in it.

            Four zeros used to mean two completely different things — "this week has no
            unreachable leads" and "nobody has pressed Isolate for this week" — and the
            11/09 week showed the second while reading as the first, with 47 leads waiting.
            The only control that could enrol them lived behind a chip on the Renewal Week
            tab, which is not a place anyone looking at an empty pipeline would think to go.

            Isolating is free, calls no vendor, sends nothing, and remembers each lead's
            status so it can be undone. So the action belongs here, next to the gap it fills.
          */}
          {!!pipeline.counts?.awaitingIsolation && (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={
                <Button
                  size="small"
                  disabled={isolateState.busy}
                  onClick={() => {
                    const n = pipeline.counts?.awaitingIsolation ?? 0;
                    if (confirm(
                      `Isolate ${n} Grade A lead${n === 1 ? '' : 's'} with no insured email?\n\n`
                      + 'They move into this pipeline so they can be worked through Tracerfy and '
                      + 'BatchData. Each lead\'s current status is remembered and restored '
                      + 'automatically if an address turns up.\n\n'
                      + 'Nothing is sent and no vendor is called — this costs nothing.',
                    )) runIsolate(false);
                  }}
                >
                  {isolateState.busy ? 'Working…' : `Isolate ${pipeline.counts.awaitingIsolation}`}
                </Button>
              }
            >
              <strong>
                {pipeline.counts.awaitingIsolation} Grade A lead
                {pipeline.counts.awaitingIsolation === 1 ? '' : 's'} in this range {pipeline.counts.awaitingIsolation === 1 ? 'has' : 'have'} no insured email and {pipeline.counts.awaitingIsolation === 1 ? 'is' : 'are'} not in the pipeline yet.
              </strong>
              {' '}The stages below only count leads that have been isolated, so they read
              zero until these are enrolled. Isolating is free and reversible.
            </Alert>
          )}

          {isolateState.msg && (
            <Typography variant="caption" sx={{ color: '#8a5a00', display: 'block', mb: 1.5 }}>
              {isolateState.msg}
            </Typography>
          )}

          {(pipeline.stage === 'isolated' || pipeline.stage === 'tracerfy') && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }} useFlexGap>
              {/*
                The button no longer tries to predict whether the account can pay.
                Neither vendor publishes a balance, so any figure here is arithmetic on a
                number somebody typed in — and once the account was topped up outside the
                CRM that arithmetic went negative and disabled the stage while the vendor
                dashboard showed a balance. Guessing wrong in that direction blocks work
                that was affordable all along.

                The run finds out instead: it tries, the vendor refuses, it stops on the
                spot and says so. Nothing below the refusal is attempted, so an empty
                account costs one call rather than the ~290 it cost the last time a blast
                carried on regardless.
              */}
              {(() => {
                const vendor = pipeline.stage === 'isolated' ? 'tracerfy' : 'batchdata';
                const pool = pipeline.counts?.[pipeline.stage] ?? 0;
                return (
                  <>
                    <Button
                      size="small" variant="contained"
                      startIcon={pipeline.busy ? <CircularProgress size={13} color="inherit" /> : <BoltIcon />}
                      onClick={() => runPipelineBlast(vendor, false)}
                      disabled={pipeline.busy || !pool}
                    >
                      {`Run ${vendor === 'tracerfy' ? 'Tracerfy' : 'BatchData'} on `}
                      {pool <= MAX_PER_BLAST ? pool : `${MAX_PER_BLAST} of ${pool}`}
                    </Button>
                    <Typography variant="caption" sx={{ color: '#8a5a00' }}>
                      {pool > MAX_PER_BLAST
                        ? `Costs money · capped at ${MAX_PER_BLAST} per run, so this needs ${Math.ceil(pool / MAX_PER_BLAST)} runs · leads that return nothing move to the next stage`
                        : 'Costs money · leads that return nothing move to the next stage'}
                    </Typography>
                  </>
                );
              })()}
            </Stack>
          )}

          {pipeline.msg && (
            <Typography variant="caption" sx={{ display: 'block', mb: 1, color: '#1565c0', fontWeight: 600 }}>
              {pipeline.msg}
            </Typography>
          )}

          {/*
            Shown only when a run actually stopped itself. It reports what happened rather
            than what might: the vendor refused, at this point, with this many leads left.
          */}
          {pipeline.stopped && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>
                {pipeline.stopped.reason === 'no_credits'
                  ? `${pipeline.stopped.vendor} is out of credits — the run stopped.`
                  : pipeline.stopped.reason === 'auth'
                    ? `${pipeline.stopped.vendor} rejected the API key — the run stopped.`
                    : `${pipeline.stopped.vendor} failed on three calls in a row — the run stopped.`}
              </strong>
              {' '}
              {pipeline.stopped.remaining > 0
                ? `${pipeline.stopped.remaining} lead${pipeline.stopped.remaining === 1 ? '' : 's'} in this batch ${pipeline.stopped.remaining === 1 ? 'was' : 'were'} not attempted and ${pipeline.stopped.remaining === 1 ? 'has' : 'have'} not been charged — still at this stage, so the same button picks up where this left off.`
                : 'Every lead in this batch had already been attempted.'}
              {pipeline.stopped.reason === 'no_credits' && ' Top up and run it again.'}
              <Box sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: 11, color: '#5a6675' }}>
                {pipeline.stopped.vendor} said: {pipeline.stopped.detail}
              </Box>
            </Alert>
          )}

          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Lead ID', 'Owner', 'City / ZIP', 'Eff date', 'Grade', 'Status', 'Insured email?', 'Phone?', 'Tracerfy tried', 'BatchData tried', 'Recovered by'].map((h) => (
                    <TableCell key={h} sx={{ fontFamily: 'monospace', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: '#5a6675', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {pipeline.rows.slice(0, MAX_RENDERED).map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontSize: 11, fontFamily: 'monospace' }}>
                      <Link href={`/leads/${r.id}?from=qc`} style={{ color: '#6b7280', textDecoration: 'none' }}>{r.id}</Link>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Link href={`/leads/${r.id}?from=qc`} style={{ color: '#1565c0', textDecoration: 'none' }}>{r.owner}</Link>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.city} <span style={{ color: '#9098a6' }}>{r.zip}</span></TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.effectiveDate ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Chip label={r.grade ?? '?'} size="small" sx={{ bgcolor: gradeColor(r.grade), color: '#fff', fontWeight: 700, height: 19 }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.status ?? '—'}</TableCell>
                    {/*
                      Green Yes / red No, not a dash: this is the column that says whether
                      the lead can be mailed at all, which is the whole point of the
                      pipeline. A dash would read as "unknown" when it is a definite no.
                    */}
                    <TableCell sx={{ fontSize: 12, fontWeight: 700, color: r.hasEmail ? '#166534' : '#b3261e' }}>
                      {r.hasEmail ? 'Yes' : 'No'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.hasPhone ? 'Yes' : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.triedTracerfyAt ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.triedBatchDataAt ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12, fontWeight: r.recoveredBy ? 700 : 400, color: r.recoveredBy ? '#166534' : 'inherit' }}>
                      {r.recoveredBy ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {!pipeline.rows.length && (
                  <TableRow>
                    <TableCell colSpan={11} sx={{ fontSize: 12, color: '#5a6675', py: 2 }}>
                      Nothing at this stage for the chosen dates.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/*
        The old per-run history and the raw row table are hidden on this tab.
        
        The recovery pipeline above now answers the question this tab exists for — where
        each lead stands and what each vendor found — and showing a second, differently
        shaped count of the same leads underneath it is exactly how two numbers on one
        screen end up being argued about. Export CSV still writes every row.
      */}
      {report !== 'blast_skiptrace' && blastRuns && blastRuns.length > 0 && (
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

      {report !== 'blast_skiptrace' && (
        <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          {loading ? <CircularProgress size={18} /> : <Typography variant="body2" color="text.secondary"><strong>{shownRows.length}</strong> record{shownRows.length === 1 ? '' : 's'}</Typography>}
        </Box>
      )}

      {report !== 'blast_skiptrace' && (
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
                      : /Email|Phone/.test(c.header)
                        // Several addresses per cell: wrap rather than stretch the table.
                        ? { maxWidth: 230, fontSize: 12, color: '#3d4658', wordBreak: 'break-word' }
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
      )}
    </Container>
  );
}
