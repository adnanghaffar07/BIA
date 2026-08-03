'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Box, Breadcrumbs, Button, Chip, CircularProgress, Divider, Grid,
  MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
  Alert, Snackbar, FormControl, InputLabel, Checkbox, FormControlLabel, FormHelperText,
} from '@mui/material';
import Link from 'next/link';
import { getMissingFields } from '@/services/grade.service';
import { GRADE_INFO, LeadGrade } from '@/types/grade';
import { LEAD_STATUS_OPTIONS, leadStatusLabel, CLOSED_STATUSES, LeadStatus } from '@/types/lead';
import { ELIGIBILITY_REASONS } from '@/types/carrier';
import { WIPP_BY_ZIP } from '@/services/taxRoll.service';
import { parseRollOwners } from '@/services/ownerNameMatch.service';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import WavesIcon from '@mui/icons-material/Waves';
import SaveIcon from '@mui/icons-material/Save';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import GavelIcon from '@mui/icons-material/Gavel';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import VerifiedIcon from '@mui/icons-material/Verified';
import SkipTraceDialog from '@/components/SkipTraceDialog';
import { useAuth } from '@/context/AuthContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, prefix = '') {
  if (v == null) return '—';
  return `${prefix}${Number(v).toLocaleString()}`;
}

/**
 * Suggested Indicative Band Price from the rated premiums (Frank, Jul-2026 sync).
 * This is the outreach hook — "we have you rated at $725–$900" — so it must be
 * credible, not a wide guess.
 *
 * Both carriers rated → the spread between them, rounded outward to $25. Matches
 * Frank's worked examples exactly: $750 & $899 → $725–$900; $760 & $900 → $750–$900.
 * (Low nudges to the next $25 BELOW — strictly below when it lands on a boundary.)
 * Only one carrier rated → ±$250 around it, his fallback for a single data point.
 * Producers override whenever their judgement differs.
 */
export function suggestBand(travelers?: number, plymouth?: number): { low: number; high: number } | null {
  const vals = [travelers, plymouth].filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const strictFloor25 = (n: number) => { const f = Math.floor(n / 25) * 25; return f === n ? n - 25 : f; };
  const ceil25 = (n: number) => Math.ceil(n / 25) * 25;
  if (vals.length === 2) return { low: strictFloor25(Math.min(...vals)), high: ceil25(Math.max(...vals)) };
  const p = vals[0];
  return { low: strictFloor25(p - 250), high: ceil25(p + 250) };
}

/** Read-only DOB display — "1962-01-01 · age 64 (est.)". Age is derived from the
 *  year so it stays correct whether the DOB is REAPI-estimated or admin-corrected. */
function dobDisplay(v: unknown): string {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const y = parseInt(s.slice(0, 4), 10);
  const age = y ? new Date().getFullYear() - y : null;
  return `${s}${age && age > 0 && age < 120 ? ` · age ${age}` : ''} (est.)`;
}

function fmtCurrency(v: number | null | undefined) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

// Grade chip colors — sourced from GRADE_INFO so the detail page matches the
// lead table exactly (A green · B orange · C red · D grey).
function gradeChipSx(g: string | null) {
  const info = GRADE_INFO[(g ?? '') as LeadGrade];
  if (!info) return {};
  return {
    backgroundColor: info.backgroundColor,
    color: info.color,
    border: `1px solid ${info.borderColor}`,
    fontWeight: 700,
  };
}

function statusLabel(s: string | null) {
  return leadStatusLabel(s);
}

function coastChip(exposure: string | null) {
  if (!exposure) return <Chip label="No coord data" size="small" />;
  const map: Record<string, { color: 'error' | 'warning' | 'info' | 'success', label: string }> = {
    extreme: { color: 'error', label: '🔴 Extreme Coastal' },
    high: { color: 'warning', label: '🟠 High Coastal' },
    moderate: { color: 'info', label: '🟡 Moderate Coastal' },
    low: { color: 'success', label: '🟢 Low Coastal Risk' },
  };
  const cfg = map[exposure] ?? { color: 'default' as any, label: exposure };
  return <Chip label={cfg.label} color={cfg.color} size="small" />;
}

function eligibilityIcon(status: string | null) {
  if (status === 'eligible') return <CheckCircleIcon fontSize="small" color="success" />;
  if (status === 'ineligible') return <CancelIcon fontSize="small" color="error" />;
  return <HelpOutlineIcon fontSize="small" color="warning" />;
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children, sx }: { title: string; children: React.ReactNode; sx?: object }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, ...sx }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', py: 0.5 }} spacing={1}>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 110, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 500, textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
    </Stack>
  );
}

// Labelled heading for a sub-section inside the Row 1 / Row 2 worksheet bands.
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'primary.main', display: 'block', mb: 0.75, pb: 0.5, borderBottom: '2px solid', borderColor: 'divider' }}>
      {children}
    </Typography>
  );
}

// Compact labelled <Select> for the editable Home-Features / confirm-on-call forms.
// `options` are [value, label] tuples; an "Unknown" (empty) choice is always first.
function FeatureSelect({ label, value, onChange, options, unknownLabel = 'Unknown' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  unknownLabel?: string;
}) {
  return (
    <FormControl size="small" fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select value={value ?? ''} label={label} onChange={(e) => onChange(e.target.value)}>
        <MenuItem value=""><em>{unknownLabel}</em></MenuItem>
        {options.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
      </Select>
    </FormControl>
  );
}

// Travelers Q#7 restricted dog breeds — confirmed by a BIA employee on first contact.
const RESTRICTED_DOG_BREEDS = [
  'Akita', 'Alaskan Malamute', 'American Bull Terrier', 'American Staffordshire Terrier',
  'Mastiff', 'Chow Chow', 'Doberman Pinscher', 'Pit Bull', 'Presa Canario',
  'Rottweiler', 'Staffordshire Bull Terrier', 'Wolf Hybrid',
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Return to wherever the producer came from — the actual previous page (filtered
  // Leads, a specific Queue tab, QC Reports, …) — instead of a hardcoded route.
  // Falls back to the leads list only when there's no in-app history (direct open).
  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/leads');
  };

  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nextLeadId, setNextLeadId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({ open: false, msg: '', severity: 'success' });

  // Producer form state
  const [status, setStatus] = useState('');
  const [posQuoteNumber, setPosQuoteNumber] = useState('');
  const [posCarrier, setPosCarrier] = useState('');
  const [posQuotePremium, setPosQuotePremium] = useState('');
  const [boundPremium, setBoundPremium] = useState('');
  const [varianceNotes, setVarianceNotes] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [authorizationMethod, setAuthorizationMethod] = useState('');
  const [authorizationDate, setAuthorizationDate] = useState<string | null>(null);
  const [stampingAuth, setStampingAuth] = useState(false);
  const [skipTracing, setSkipTracing] = useState(false);
  const [verifyingOwner, setVerifyingOwner] = useState(false);
  const [floodChecking, setFloodChecking] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [lostStage, setLostStage] = useState('');
  const [producerNote, setProducerNote] = useState('');
  // Manual grade override + revisit + competitor capture
  const [manualGrade, setManualGrade] = useState('');
  const [gradeOverrideReason, setGradeOverrideReason] = useState('');
  const [revisitFlag, setRevisitFlag] = useState(false);
  const [revisitDate, setRevisitDate] = useState('');
  const [revisitNote, setRevisitNote] = useState('');
  const [competitorCarrier, setCompetitorCarrier] = useState('');
  const [competitorPremium, setCompetitorPremium] = useState('');
  // Roof confirmation (year clears the B/C roof-age gate; type drives carrier eligibility)
  const [roofYear, setRoofYear] = useState('');
  const [roofType, setRoofType] = useState('');
  // Frank Jun-2026: dual insureds / DOB / confirm-on-call / home features (single bag)
  const [extra, setExtra] = useState<Record<string, any>>({});
  const setEx = (k: string, v: any) => setExtra((p) => ({ ...p, [k]: v }));
  const [showCondoFields, setShowCondoFields] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/leads/${id}`);
    const json = await res.json();
    if (json.success) {
      const l = json.data;
      setLead(l);
      setStatus(l.status ?? 'new');
      setPosQuoteNumber(l.posQuoteNumber ?? '');
      setPosCarrier(l.posCarrier ?? '');
      setPosQuotePremium(l.posQuotePremium != null ? String(l.posQuotePremium) : '');
      setBoundPremium(l.boundPremium != null ? String(l.boundPremium) : '');
      setVarianceNotes(l.varianceNotes ?? '');
      setVarianceReason(l.varianceReason ?? '');
      setAuthorizationMethod(l.authorizationMethod ?? '');
      setAuthorizationDate(l.authorizationDate ?? null);
      setLostReason(l.lostReason ?? '');
      setLostStage(l.lostStage ?? '');
      setManualGrade(l.manualGrade ?? '');
      setGradeOverrideReason(l.gradeOverrideReason ?? '');
      setRevisitFlag(!!l.revisitFlag);
      setRevisitDate(l.revisitDate ? String(l.revisitDate).slice(0, 10) : '');
      setRevisitNote(l.revisitNote ?? '');
      setCompetitorCarrier(l.competitorCarrier ?? '');
      setCompetitorPremium(l.competitorPremium != null ? String(l.competitorPremium) : '');
      setRoofYear(l.roofYear != null ? String(l.roofYear) : '');
      setRoofType(l.roofType ?? '');
      setExtra({
        owner2FirstName: l.owner2FirstName ?? '',
        owner2LastName: l.owner2LastName ?? '',
        maritalStatus: l.maritalStatus ?? '',
        owner1Dob: l.owner1Dob ? String(l.owner1Dob).slice(0, 10) : '',
        owner2Dob: l.owner2Dob ? String(l.owner2Dob).slice(0, 10) : '',
        reapiDob: l.reapiDob ? String(l.reapiDob).slice(0, 10) : '',
        dogBreed: l.dogBreed ?? '',
        insuranceHistory: l.insuranceHistory ?? 'currently_insured', // assumed valid until call
        heatingRenovatedYear: l.heatingRenovatedYear != null ? String(l.heatingRenovatedYear) : '',
        bathroomsFull: l.bathroomsFull != null ? String(l.bathroomsFull) : '',
        bathroomsHalf: l.bathroomsHalf != null ? String(l.bathroomsHalf) : '',
        garageType: l.garageType ?? '',
        garageCount: l.garageCount != null ? String(l.garageCount) : '',
        sidingType: l.sidingType ?? '',
        foundationType: l.foundationType ?? '',
        heatSource: l.heatSource ?? 'gas', // NJ default
        feetFromHydrant: l.feetFromHydrant != null ? String(l.feetFromHydrant) : '',
        burglarAlarm: l.burglarAlarm ?? '',
        fireAlarm: l.fireAlarm ?? '',
        sprinklerSystem: !!l.sprinklerSystem,
        smokeDetector: l.smokeDetector ?? '',
        waterSensor: l.waterSensor ?? '',
        autoWaterShutoff: l.autoWaterShutoff ?? '',
        lowTempSensor: l.lowTempSensor ?? '',
        leedCertified: !!l.leedCertified,
        effectiveDate: l.effectiveDate ? String(l.effectiveDate).slice(0, 10) : '',
        floodZoneType: l.floodZoneType ?? '',
        floodZoneManual: !!l.floodZoneManual,
        travelersPremium: l.travelersPremium != null ? String(l.travelersPremium) : '',
        plymouthPremium: l.plymouthPremium != null ? String(l.plymouthPremium) : '',
        travelersEligible: l.travelersEligible ?? '',
        plymouthEligible: l.plymouthEligible ?? '',
        travelersEligibilityReason: l.travelersEligibilityReason ?? '',
        plymouthEligibilityReason: l.plymouthEligibilityReason ?? '',
        travelersEligibilityDetail: l.travelersEligibilityDetail ?? '',
        plymouthEligibilityDetail: l.plymouthEligibilityDetail ?? '',
        indicativeBandLow: l.indicativeBandLow != null ? String(l.indicativeBandLow) : '',
        indicativeBandHigh: l.indicativeBandHigh != null ? String(l.indicativeBandHigh) : '',
        doNotRevisit: !!l.doNotRevisit,
        phone1: l.phone1 ?? '',
        email1: l.email1 ?? '',
        basementFinishedPct: l.basementFinishedPct ?? '',
        propertyTypeMismatch: !!l.propertyTypeMismatch,
        bathroomGrade: l.bathroomGrade ?? '',
        kitchenCount: l.kitchenCount != null ? String(l.kitchenCount) : '',
        kitchenGrade: l.kitchenGrade ?? '',
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /** Pre-fetch the next active Grade-A lead by x-date so "Save & Next" is instant */
  const prefetchNextLead = useCallback(async () => {
    try {
      const res = await fetch('/api/leads?source=db&size=50&active=true&grade=A&orderBy=xdate');
      const json = await res.json();
      if (json.success && json.data?.length) {
        const next = json.data.find((l: any) => l.propertyId !== id);
        setNextLeadId(next?.propertyId ?? null);
      }
    } catch { /* silent */ }
  }, [id]);

  useEffect(() => { prefetchNextLead(); }, [prefetchNextLead]);

  // ── Dirty tracking ──────────────────────────────────────────────────────────
  // Snapshot every editable field; Save stays disabled until one of them changes.
  const [pristine, setPristine] = useState<string | null>(null);
  const formSnapshot = JSON.stringify({
    status, posQuotePremium, boundPremium, varianceNotes, varianceReason,
    authorizationMethod, lostReason, lostStage, producerNote, manualGrade,
    gradeOverrideReason, revisitFlag, revisitDate, revisitNote,
    competitorCarrier, competitorPremium, roofYear, roofType, extra,
  });
  useEffect(() => {
    // Re-baseline the snapshot whenever a fresh lead is loaded or a save returns new data.
    if (!loading && lead) setPristine(formSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, loading]);
  const dirty = pristine !== null && formSnapshot !== pristine;

  const save = async (andNext = false) => {
    // Grade-override gate (Frank Phase 5b): changing the grade requires a comment.
    if (manualGrade && !gradeOverrideReason.trim()) {
      setSnackbar({ open: true, msg: 'A reason is required to save a manual grade override.', severity: 'error' });
      return;
    }
    // Close-out gate (Frank Phase 5): a lead can't be marked LOST without an
    // explanation (reason + stage) AND a revisit election (revisit OR do-not-revisit).
    if (status === 'lost') {
      if (!lostReason || !lostStage) {
        setSnackbar({ open: true, msg: 'Lost requires a reason and the stage it was lost at.', severity: 'error' });
        return;
      }
      if (!revisitFlag && !extra.doNotRevisit) {
        setSnackbar({ open: true, msg: 'Close-out: choose "Revisit next year" or "Do Not Revisit" before closing.', severity: 'error' });
        return;
      }
    }
    setSaving(true);
    const bp = boundPremium ? parseFloat(boundPremium) : undefined;
    const pqp = posQuotePremium ? parseFloat(posQuotePremium) : undefined;
    const varianceAmount = bp && lead?.expectedPremium
      ? Math.round((bp - lead.expectedPremium) * 10) / 10
      : undefined;

    const body: any = {
      status,
      posQuoteNumber: posQuoteNumber || undefined,
      posCarrier: posCarrier || undefined,
      posQuotePremium: pqp,
      boundPremium: bp,
      varianceNotes: varianceNotes || undefined,
      varianceReason: varianceReason || undefined,
      varianceAmount,
      authorizationMethod: authorizationMethod || undefined,
      lostReason: status === 'lost' ? (lostReason || undefined) : undefined,
      lostStage: status === 'lost' ? (lostStage || undefined) : undefined,
      // Manual grade override — send the field so the API can clear it when blank
      manualGrade: manualGrade || '',
      gradeOverrideReason: gradeOverrideReason || undefined,
      // Revisit / future re-engagement
      revisitFlag,
      revisitDate: revisitFlag && revisitDate ? revisitDate : undefined,
      revisitNote: revisitFlag ? (revisitNote || undefined) : undefined,
      // Lost-to-competitor price (only meaningful when lost)
      competitorCarrier: status === 'lost' ? (competitorCarrier || undefined) : undefined,
      competitorPremium: status === 'lost' && competitorPremium ? parseFloat(competitorPremium) : undefined,
      // Roof confirmation (producer-entered). Empty roof type → left as 'Unknown'.
      roofYear: roofYear ? parseInt(roofYear, 10) : undefined,
      roofType: roofType || undefined,
      // Frank Jun-2026: dual insureds / DOB / confirm-on-call / home features
      owner2FirstName: extra.owner2FirstName || undefined,
      owner2LastName: extra.owner2LastName || undefined,
      maritalStatus: extra.maritalStatus || undefined,
      owner1Dob: extra.owner1Dob || undefined,
      owner2Dob: extra.owner2Dob || undefined,
      // Admin-only DOB override (correct a wrong skip-trace estimate)
      ...(isAdmin ? { reapiDob: extra.reapiDob || undefined } : {}),
      dogBreed: extra.dogBreed || undefined,
      insuranceHistory: extra.insuranceHistory || undefined,
      heatingRenovatedYear: extra.heatingRenovatedYear ? parseInt(extra.heatingRenovatedYear, 10) : undefined,
      bathroomsFull: extra.bathroomsFull !== '' && extra.bathroomsFull != null ? parseInt(extra.bathroomsFull, 10) : undefined,
      bathroomsHalf: extra.bathroomsHalf !== '' && extra.bathroomsHalf != null ? parseInt(extra.bathroomsHalf, 10) : undefined,
      garageType: extra.garageType || undefined,
      garageCount: extra.garageCount !== '' && extra.garageCount != null ? parseInt(extra.garageCount, 10) : undefined,
      sidingType: extra.sidingType || undefined,
      foundationType: extra.foundationType || undefined,
      heatSource: extra.heatSource || undefined,
      feetFromHydrant: extra.feetFromHydrant !== '' && extra.feetFromHydrant != null ? parseInt(extra.feetFromHydrant, 10) : undefined,
      burglarAlarm: extra.burglarAlarm || undefined,
      fireAlarm: extra.fireAlarm || undefined,
      sprinklerSystem: !!extra.sprinklerSystem,
      smokeDetector: extra.smokeDetector || undefined,
      waterSensor: extra.waterSensor || undefined,
      autoWaterShutoff: extra.autoWaterShutoff || undefined,
      lowTempSensor: extra.lowTempSensor || undefined,
      leedCertified: !!extra.leedCertified,
      effectiveDate: extra.effectiveDate || undefined,
      // FEMA flood override (Phase 3a): when manual, send the zone + flag so
      // re-enrichment won't overwrite it with the FEMA lookup.
      floodZoneManual: !!extra.floodZoneManual,
      floodZoneType: extra.floodZoneManual ? (extra.floodZoneType || undefined) : undefined,
      // Carrier eligibility override (producer-editable) + reason for the change
      travelersEligible: extra.travelersEligible || undefined,
      plymouthEligible: extra.plymouthEligible || undefined,
      travelersEligibilityReason: extra.travelersEligibilityReason || undefined,
      plymouthEligibilityReason: extra.plymouthEligibilityReason || undefined,
      travelersEligibilityDetail: extra.travelersEligibilityDetail || undefined,
      plymouthEligibilityDetail: extra.plymouthEligibilityDetail || undefined,
      // Indicative band price for outreach merge (auto-suggested, producer-overridable)
      indicativeBandLow: extra.indicativeBandLow !== '' && extra.indicativeBandLow != null ? parseFloat(extra.indicativeBandLow) : undefined,
      indicativeBandHigh: extra.indicativeBandHigh !== '' && extra.indicativeBandHigh != null ? parseFloat(extra.indicativeBandHigh) : undefined,
      // Phase 5: carrier pricing + auto-assigned (cheaper) carrier
      travelersPremium: extra.travelersPremium !== '' && extra.travelersPremium != null ? parseFloat(extra.travelersPremium) : undefined,
      plymouthPremium: extra.plymouthPremium !== '' && extra.plymouthPremium != null ? parseFloat(extra.plymouthPremium) : undefined,
      assignedCarrier: (() => {
        const t = parseFloat(extra.travelersPremium); const p = parseFloat(extra.plymouthPremium);
        const tOk = !isNaN(t); const pOk = !isNaN(p);
        return tOk && pOk ? (t <= p ? 'travelers' : 'plymouth') : tOk ? 'travelers' : pOk ? 'plymouth' : undefined;
      })(),
      doNotRevisit: !!extra.doNotRevisit,
      phone1: extra.phone1 || undefined,
      email1: extra.email1 || undefined,
      basementFinishedPct: extra.basementFinishedPct || undefined,
      propertyTypeMismatch: !!extra.propertyTypeMismatch,
      bathroomGrade: extra.bathroomGrade || undefined,
      kitchenCount: extra.kitchenCount !== '' && extra.kitchenCount != null ? parseInt(extra.kitchenCount, 10) : undefined,
      kitchenGrade: extra.kitchenGrade || undefined,
      _createdBy: lead?.producerEmail || undefined,
      // Only send an explicit note when the producer typed one; otherwise the server
      // auto-logs the actual field-level changes (status, grade, edited fields).
      ...(producerNote ? { _activityNote: producerNote, _activityType: 'note' } : {}),
    };

    const res = await fetch(`/api/leads/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (json.success) {
      setLead(json.data);
      setProducerNote('');
      if (andNext && nextLeadId) {
        router.push(`/leads/${nextLeadId}`);
      } else {
        setSnackbar({ open: true, msg: 'Lead saved successfully', severity: 'success' });
        prefetchNextLead();
      }
    } else {
      setSnackbar({ open: true, msg: 'Save failed — try again', severity: 'error' });
    }
    setSaving(false);
  };

  /** One-click: stamp authorizationDate = now and persist immediately */
  const stampAuthDate = async () => {
    setStampingAuth(true);
    const now = new Date().toISOString();
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorizationDate: now,
        authorizationMethod: authorizationMethod || undefined,
        _activityNote: 'Authorization date stamped',
        _activityType: 'status_change',
      }),
    });
    const json = await res.json();
    if (json.success) {
      setAuthorizationDate(now);
      setLead(json.data);
      setSnackbar({ open: true, msg: 'Authorization date stamped', severity: 'success' });
    } else {
      setSnackbar({ open: true, msg: 'Failed to stamp authorization date', severity: 'error' });
    }
    setStampingAuth(false);
  };

  /** Run a REAPI skip trace for this lead (gated: carrier-qualified + not yet traced). */
  /** Confirm the insured name against the municipal tax roll (free, on demand). */
  const runOwnerVerifyAction = async () => {
    setVerifyingOwner(true);
    try {
      const res = await fetch(`/api/leads/${id}/verify-owner?force=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _createdBy: lead?.producerEmail || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        const st = json.result?.status ?? lead?.ownerVerifyStatus;
        setSnackbar({
          open: true,
          msg: st === 'match' ? 'Insured name confirmed against the tax roll'
            : st === 'partial' ? `Surname matches — tax roll shows "${json.result?.recordName}"`
            : st === 'mismatch' ? `Name mismatch — tax roll shows "${json.result?.recordName}"`
            : 'Could not confirm the insured name',
          severity: st === 'match' ? 'success' : 'error',
        });
        await load();
      } else {
        setSnackbar({ open: true, msg: json.error || 'Owner verification failed', severity: 'error' });
      }
    } catch {
      setSnackbar({ open: true, msg: 'Owner verification failed', severity: 'error' });
    } finally {
      setVerifyingOwner(false);
    }
  };

  const runSkipTraceAction = async () => {
    setSkipTracing(true);
    try {
      const res = await fetch(`/api/leads/${id}/skip-trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _createdBy: lead?.producerEmail || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        const r = json.result ?? {};
        const found = (r.phones?.length ?? 0) + (r.emails?.length ?? 0);
        setSnackbar({
          open: true,
          msg: found > 0
            ? `Skip trace: ${r.phones?.length ?? 0} phone(s), ${r.emails?.length ?? 0} email(s) found`
            : 'Skip trace ran — no contact match found',
          severity: found > 0 ? 'success' : 'error',
        });
        await load(); // refresh phone/email/skipTraced from the server
      } else {
        setSnackbar({ open: true, msg: json.error || 'Skip trace failed', severity: 'error' });
      }
    } catch {
      setSnackbar({ open: true, msg: 'Skip trace failed — try again', severity: 'error' });
    }
    setSkipTracing(false);
  };

  /** Re-check FEMA flood zone for this lead (FREE — no credits). */
  const runFloodCheckAction = async () => {
    setFloodChecking(true);
    try {
      const res = await fetch(`/api/leads/${id}/flood`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const z = json.result ?? {};
        setSnackbar({
          open: true,
          msg: `FEMA flood: ${z.zone ?? '—'}${z.sfha ? ' (SFHA high-risk)' : ''}`,
          severity: 'success',
        });
        await load(); // refresh flood fields + grade from the server
      } else {
        setSnackbar({ open: true, msg: json.error || 'Flood re-check failed', severity: 'error' });
      }
    } catch {
      setSnackbar({ open: true, msg: 'Flood re-check failed — try again', severity: 'error' });
    }
    setFloodChecking(false);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!lead) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">Lead not found.</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mt: 2 }}>Back</Button>
      </Box>
    );
  }

  const address = `${lead.addressStreet}, ${lead.addressCity}, ${lead.addressState} ${lead.addressZip}`;
  // Expiration = effective + 1 year (standard annual policy term, Frank Jul-2026). Derived, not stored.
  const expirationDate = (() => {
    const base = lead.effectiveDate || lead.renewalTargetDate;
    if (!base) return null;
    const d = new Date(base);
    if (isNaN(d.getTime())) return null;
    d.setFullYear(d.getFullYear() + 1);
    return d.toLocaleDateString();
  })();

  const hasRealName = !!(lead.owner1FirstName || lead.owner1LastName);
  const ownerName = [lead.owner1FirstName, lead.owner1LastName].filter(Boolean).join(' ') || '—';
  const coInsuredName = [lead.owner2FirstName, lead.owner2LastName].filter(Boolean).join(' ');

  // No insured name on file, but the tax roll gave us one. Show it as a SUGGESTION —
  // greyed/italic, no verified tick — because it is the roll's word alone (nothing of
  // ours agreed with it). A producer confirms it on the call, which promotes it to the
  // real insured name. Never render this as a tick: that would be self-referential.
  const rollSuggestedName = !hasRealName && lead.ownerVerifyName ? String(lead.ownerVerifyName) : null;

  // Second insured from the tax roll (Frank Jul-2026): the roll lists both owners —
  // typically husband + wife on title — in one field ("SCHEIDT, WOODROW W & MARY ANN").
  // Surface the spouse as a confirm-on-call suggestion whenever we don't already have a
  // co-insured on file, so both can be reached (2x the outreach chance on one lead).
  const hasCoInsured = !!(lead.owner2FirstName || lead.owner2LastName);
  const rollSecondInsured = (!hasCoInsured && lead.ownerVerifyName)
    ? (parseRollOwners(String(lead.ownerVerifyName)).person2?.display ?? null)
    : null;

  // Owner-name verification badge (Frank Jul-2026). Shows the outcome of checking the
  // insured name against the municipal tax roll. Deliberately graded, not a plain tick:
  // a surname-only match usually means the roll lists a spouse or co-owner, which is
  // legitimate but worth a producer's glance rather than a silent pass.
  const ownerVerify = (() => {
    const st = lead.ownerVerifyStatus as 'match' | 'partial' | 'mismatch' | 'unknown' | null;
    if (!st) return null;
    const when = lead.ownerVerifyAt ? String(lead.ownerVerifyAt).slice(0, 10) : '';
    const src = lead.ownerVerifySource ? ` · ${String(lead.ownerVerifySource).replace(/_/g, ' ')}` : '';
    const tip = `${lead.ownerVerifyDetail || ''}${lead.ownerVerifyName ? `\nTax record: ${lead.ownerVerifyName}` : ''}${when ? `\nChecked ${when}${src}` : ''}`;
    const cfg = {
      match: { icon: <VerifiedIcon sx={{ fontSize: 16 }} />, color: '#1565c0', label: 'Verified' },
      partial: { icon: <HelpOutlineIcon sx={{ fontSize: 16 }} />, color: '#8a5a00', label: 'Partial' },
      mismatch: { icon: <CancelIcon sx={{ fontSize: 16 }} />, color: '#b3261e', label: 'Name mismatch' },
      unknown: { icon: <HelpOutlineIcon sx={{ fontSize: 16 }} />, color: '#6b7280', label: 'Unverified' },
    }[st];
    if (!cfg) return null;
    return (
      <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: cfg.color, cursor: 'help' }}>
          {cfg.icon}
          <Box component="span" sx={{ fontSize: 11, fontWeight: 600 }}>{cfg.label}</Box>
        </Box>
      </Tooltip>
    );
  })();
  const isCondoLead = String(lead.propertyType ?? '').toUpperCase() === 'CONDO' || /condo/i.test(lead.landUse ?? '');
  // Mailing address — the actual signal behind "investor / absentee" (Frank Jul-2026).
  // When it differs from the property, the owner doesn't live there.
  const mailAddress = [lead.mailStreet, lead.mailCity, lead.mailState].filter(Boolean).join(', ');
  const mailDiffers = !!lead.mailStreet && !!lead.addressStreet
    && String(lead.mailStreet).trim().toLowerCase() !== String(lead.addressStreet).trim().toLowerCase();

  // Save gate (Frank Phase 5b): disable Save / Save & Next until required fields pass —
  // a grade override needs a reason; a LOST lead needs reason + stage + revisit election.
  const overrideNeedsReason = !!manualGrade && !gradeOverrideReason.trim();
  const lostNeedsFields = status === 'lost' && (!lostReason || !lostStage || (!revisitFlag && !extra.doNotRevisit));
  const saveBlocked = overrideNeedsReason || lostNeedsFields;
  const saveBlockedMsg = overrideNeedsReason
    ? 'Enter a reason for the manual grade override to save.'
    : lostNeedsFields
      ? 'Complete all Lost fields (reason, stage, revisit election) to save.'
      : '';

  // Flood grade-cap signal (Frank Jun-2026) — mirrors floodZoneGradeCap() in grade.service.
  const floodZ = String(lead.floodZoneType ?? '').trim().toUpperCase();
  const floodSub = String(lead.floodZoneSubtype ?? '').toUpperCase();
  const floodCapNote: { severity: 'error' | 'warning'; text: string } | null =
    (lead.floodSfha === true || /^(A|V)/.test(floodZ))
      ? { severity: 'error', text: `High-risk SFHA flood zone ${lead.floodZoneType || ''} — downgraded to D for Travelers & Plymouth.` }
      : (floodZ === 'X500' || floodZ.includes('0.2') || floodSub.includes('0.2') || floodSub.includes('SHADED'))
        ? { severity: 'warning', text: 'Moderate (shaded Zone X) flood — grade capped at C.' }
        : null;

  const varDiff = lead.boundPremium && lead.expectedPremium
    ? lead.boundPremium - lead.expectedPremium
    : null;

  const travelersNotes: string[] = typeof lead.travelersNotes === 'string'
    ? JSON.parse(lead.travelersNotes || '[]')
    : lead.travelersNotes ?? [];
  const plymouthNotes: string[] = typeof lead.plymouthNotes === 'string'
    ? JSON.parse(lead.plymouthNotes || '[]')
    : lead.plymouthNotes ?? [];

  // Fields still needed to reach Grade A (Quote-Ready), and — for Grade D —
  // the carrier-appetite reasons the lead was knocked out for.
  const missingFields = getMissingFields(lead);
  const gradeInfo = GRADE_INFO[(lead.grade ?? '') as LeadGrade];
  const ineligibleReasons = lead.grade === 'D'
    ? Array.from(new Set([
      ...(lead.travelersEligible === 'ineligible' ? travelersNotes : []),
      ...(lead.plymouthEligible === 'ineligible' ? plymouthNotes : []),
    ]))
    : [];

  // Producer-editable carrier eligibility (Frank Jun-2026). Three states; the token
  // 'review' is shown as "Referral". Changing it from the system value reveals a
  // required reason box that is saved + captured in the activity log.
  const ELIG_OPTS: [string, string][] = [
    ['eligible', 'Eligible'],
    ['review', 'Referral'],
    ['ineligible', 'Non-eligible'],
  ];
  const renderCarrierEligibility = (carrier: 'travelers' | 'plymouth', label: string, notes: string[]) => {
    const valKey = carrier === 'travelers' ? 'travelersEligible' : 'plymouthEligible';
    const reasonKey = carrier === 'travelers' ? 'travelersEligibilityReason' : 'plymouthEligibilityReason';
    const detailKey = carrier === 'travelers' ? 'travelersEligibilityDetail' : 'plymouthEligibilityDetail';
    const cur = extra[valKey] ?? '';
    const changed = cur !== ((lead as any)[valKey] ?? '');
    const needsReason = changed && !(extra[reasonKey] ?? '');
    const showReason = changed || !!(extra[reasonKey] ?? '') || !!(extra[detailKey] ?? '').trim();
    // Territory-driven reasons pre-fill Detail with the ZIP so trends are reportable
    // straight from the keyword search (Frank: "insert zip if FEMA related").
    const pickReason = (v: string) => {
      setEx(reasonKey, v);
      const opt = ELIGIBILITY_REASONS.find((o) => o.value === v);
      if (opt?.autoZip && !(extra[detailKey] ?? '').trim() && lead.addressZip) {
        setEx(detailKey, `ZIP ${lead.addressZip}`);
      }
    };
    return (
      <>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 0.75, flexWrap: 'wrap' }} spacing={1}>
          {eligibilityIcon(cur)}
          <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 92 }}>{label}</Typography>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select value={cur} displayEmpty onChange={(e) => setEx(valKey, e.target.value)}>
              {ELIG_OPTS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        {notes.length > 0 && (
          <Box sx={{ pl: 3.5, mb: showReason ? 1 : 1.5 }}>
            {notes.map((n, i) => (
              <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>• {n}</Typography>
            ))}
          </Box>
        )}
        {showReason && (
          <Box sx={{ pl: 3.5, mb: 1.5 }}>
            <FormControl size="small" fullWidth error={needsReason} sx={{ mb: 1 }}>
              <InputLabel>Reason for change</InputLabel>
              <Select
                label="Reason for change"
                value={extra[reasonKey] ?? ''}
                onChange={(e) => pickReason(e.target.value)}
              >
                {ELIGIBILITY_REASONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
              <FormHelperText>{needsReason ? 'Pick a reason — this is what QC reports on' : ' '}</FormHelperText>
            </FormControl>
            <TextField
              label="Detail (optional)" size="small" fullWidth multiline minRows={1}
              value={extra[detailKey] ?? ''} onChange={(e) => setEx(detailKey, e.target.value)}
              placeholder="Nuance for this specific account — e.g. the exact carrier wording"
              helperText="Free text for one-offs. The dropdown above drives trend reporting."
            />
          </Box>
        )}
      </>
    );
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Breadcrumbs sx={{ mb: 1 }}>
        <Box component="button" type="button" onClick={goBack}
          sx={{ background: 'none', border: 'none', p: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { textDecoration: 'underline' } }}>
          <ArrowBackIcon fontSize="small" /> Back
        </Box>
        <Typography color="text.primary" variant="body2">{lead.addressStreet}</Typography>
      </Breadcrumbs>

      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }} spacing={1}>
        <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1.5}>
          <HomeIcon color="action" />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{address}</Typography>
        </Stack>
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip label={`Grade ${lead.grade ?? '?'}`} sx={gradeChipSx(lead.grade)} />
          <Chip label={statusLabel(lead.status)} variant="outlined" />
          {coastChip(lead.coastExposure)}
        </Stack>
      </Stack>

      <Stack spacing={2.5}>

        {/* ══ ROW 1 · ACCOUNT DATA (read-only) ══════════════════════════ */}
        <Section title="Account Data">
          <Grid container spacing={{ xs: 2, md: 2.5 }} sx={{ mt: 0.5, alignItems: 'stretch', '& > .MuiGrid-root': { border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' } }}>

            {/* Insured */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Insured</SubHead>
              <Row
                label="Insured Named"
                value={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {rollSuggestedName ? (
                      <Tooltip title="Pulled from the municipal tax roll — no name was on file. Confirm with the insured on the call, then save it as the insured name.">
                        <Box component="span" sx={{ fontStyle: 'italic', color: '#6b7280', cursor: 'help' }}>
                          {rollSuggestedName}
                          <Box component="span" sx={{ fontStyle: 'normal', fontSize: 10, fontWeight: 600, color: '#8a5a00', ml: 0.75 }}>
                            from tax roll · confirm on call
                          </Box>
                        </Box>
                      </Tooltip>
                    ) : (
                      <>{ownerName}{ownerVerify}</>
                    )}
                  </Box>
                }
              />
              {/* Comparison row — only when we HAD a name to compare against (partial/mismatch/
                  unknown-with-name). Suppressed for roll-suggested names, which already show above. */}
              {hasRealName && lead.ownerVerifyStatus && lead.ownerVerifyStatus !== 'match' && lead.ownerVerifyName && (
                <Row label="Tax Record Shows" value={<Box component="span" sx={{ color: '#8a5a00' }}>{lead.ownerVerifyName}</Box>} />
              )}
              {!!WIPP_BY_ZIP[String(lead.addressZip ?? '').trim()]?.length && (
                <Button
                  size="small" variant="outlined" sx={{ mt: 0.5, mb: 0.5, textTransform: 'none' }}
                  startIcon={verifyingOwner ? <CircularProgress size={13} color="inherit" /> : <VerifiedIcon sx={{ fontSize: 15 }} />}
                  onClick={runOwnerVerifyAction}
                  disabled={verifyingOwner}
                >
                  {verifyingOwner ? 'Checking…' : lead.ownerVerifyStatus ? 'Re-check owner name' : 'Verify owner name'}
                </Button>
              )}
              {(lead.reapiDob || lead.owner1Dob) && (
                <Row label="REAPI DOB" value={dobDisplay(lead.reapiDob || lead.owner1Dob)} />
              )}
              {coInsuredName && <Row label="Co-Insured" value={coInsuredName} />}
              {rollSecondInsured && (
                <Row
                  label="Co-Insured"
                  value={
                    <Tooltip title="Second owner on the municipal tax roll (usually a spouse). No co-insured was on file. Confirm on the call, then save it as the co-insured.">
                      <Box component="span" sx={{ fontStyle: 'italic', color: '#6b7280', cursor: 'help' }}>
                        {rollSecondInsured}
                        <Box component="span" sx={{ fontStyle: 'normal', fontSize: 10, fontWeight: 600, color: '#8a5a00', ml: 0.75 }}>
                          from tax roll · confirm on call
                        </Box>
                      </Box>
                    </Tooltip>
                  }
                />
              )}
              {lead.owner2Dob && (
                <Row label="Co-Insured DOB" value={dobDisplay(lead.owner2Dob)} />
              )}
              <Row label="Owner Occupied" value={lead.ownerOccupied ? 'Yes' : 'No'} />
              <Row label="Absentee Owner" value={lead.absenteeOwner ? 'Yes' : 'No'} />
              {mailAddress && (
                <Row
                  label="Mailing Address"
                  value={
                    <Box component="span" sx={{ color: mailDiffers ? '#8a5a00' : 'inherit' }}>
                      {mailAddress}
                      {mailDiffers && (
                        <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 400, color: '#8a5a00' }}>
                          ≠ property address — confirm occupancy on the call
                          {/* Evidence, not proof: a trust/LLC often mails to a trustee or
                              attorney while the family lives in the home, and PO boxes,
                              snowbirds and forwarded mail all look the same here. */}
                        </Box>
                      )}
                    </Box>
                  }
                />
              )}
            </Grid>

            {/* Property Details */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Property Details</SubHead>
              <Row label="Property Type" value={lead.propertyType} />
              <Row label="Land Use" value={lead.landUse} />
              <Row label="Year Built" value={lead.yearBuilt} />
              <Row label="Sq Ft" value={lead.squareFeet ? Number(lead.squareFeet).toLocaleString() : undefined} />
              <Row label="Bedrooms / Bath" value={
                (lead.bathroomsFull != null || lead.bathroomsHalf != null)
                  ? `${lead.bedrooms ?? '—'} bd / ${lead.bathroomsFull ?? 0} full · ${lead.bathroomsHalf ?? 0} half`
                  : `${lead.bedrooms ?? '—'} bd / ${lead.bathrooms ?? '—'} ba`
              } />
              <Row label="Stories" value={lead.stories} />
              <Row label="Lot Sq Ft" value={lead.lotSquareFeet ? Number(lead.lotSquareFeet).toLocaleString() : undefined} />
              <Row label="Pool" value={lead.pool ? 'Yes' : 'No'} />
              <Row label="Garage" value={lead.garage ? 'Yes' : 'No'} />
              <Row label="Basement" value={lead.basement ? 'Yes' : 'No'} />
              <Row label="A/C" value={lead.airConditioning ? 'Yes' : 'No'} />
            </Grid>

            {/* Financials */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Financials</SubHead>
              <Row label="Estimated Value" value={fmtCurrency(lead.estimatedValue)} />
              <Row label="Assessed Value" value={fmtCurrency(lead.assessedValue)} />
              <Row label="Last Sale" value={fmtCurrency(lead.lastSaleAmount)} />
              <Row label="Last Sale Date" value={lead.lastSaleDate} />
              <Row label="Open Mortgage" value={fmtCurrency(lead.openMortgageBalance)} />
              <Row label="Lender" value={lead.lenderName} />
              <Row label="Mortgage Type" value={lead.mortgageType} />
              <Row label="Est. Equity" value={fmtCurrency(lead.estimatedEquity)} />
            </Grid>

            {/* Carrier Eligibility */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Carrier Eligibility</SubHead>
              {renderCarrierEligibility('travelers', 'Travelers', travelersNotes)}
              <Divider sx={{ my: 1 }} />
              {renderCarrierEligibility('plymouth', 'Plymouth Rock', plymouthNotes)}
            </Grid>

            {/* Flood & Coastal Risk */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Flood & Coastal Risk</SubHead>
              {/* Coastal exposure */}
              <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }} spacing={1}>
                <WavesIcon color="action" fontSize="small" />
                {coastChip(lead.coastExposure)}
              </Stack>
              <Row label="Distance to Coast" value={lead.coastDistanceMiles != null ? `${lead.coastDistanceMiles} mi` : undefined} />
              <Row label="Coordinates" value={lead.latitude && lead.longitude ? `${parseFloat(lead.latitude).toFixed(4)}, ${parseFloat(lead.longitude).toFixed(4)}` : undefined} />
              {lead.coastExposure === 'extreme' || lead.coastExposure === 'high' ? (
                <Alert severity="warning" sx={{ mt: 1, py: 0, fontSize: 12 }}>
                  Wind/hail deductibles likely apply. Confirm at binding.
                </Alert>
              ) : null}

              <Divider sx={{ my: 1.5 }} />

              {/* FEMA flood zone */}
              <Row label="FEMA Flood Zone" value={
                lead.floodZoneType
                  ? `${lead.floodZoneType}${lead.floodSfha ? ' · SFHA' : ''}${lead.floodZoneManual ? ' · manual' : ''}`
                  : (lead.floodCheckedAt ? 'X — minimal' : '— (not checked)')
              } />
              {lead.floodZoneSubtype && <Row label="Zone Detail" value={lead.floodZoneSubtype} />}
              <Box sx={{ mt: 0.75 }}>
                <Link href="https://msc.fema.gov/portal/home" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#1565c0', fontWeight: 600 }}>
                  Verify on FEMA map ↗
                </Link>
                {lead.floodCheckedAt && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    Auto-checked via FEMA NFHL {new Date(lead.floodCheckedAt).toLocaleDateString()}
                  </Typography>
                )}
              </Box>
              {floodCapNote && (
                <Alert severity={floodCapNote.severity} sx={{ mt: 1, py: 0, fontSize: 12 }}>{floodCapNote.text}</Alert>
              )}
              <Button
                size="small"
                variant="outlined"
                startIcon={floodChecking ? <CircularProgress size={14} color="inherit" /> : <WavesIcon />}
                onClick={runFloodCheckAction}
                disabled={floodChecking || lead.floodZoneManual === true || lead.latitude == null}
                sx={{ mt: 1 }}
              >
                {floodChecking ? 'Checking…' : 'Re-check Flood (FEMA)'}
              </Button>
              {lead.floodZoneManual === true && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  Manual override active — clear it to re-check FEMA.
                </Typography>
              )}
            </Grid>

            {/* Pipeline */}
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <SubHead>Pipeline</SubHead>
              <Row label="Engine" value={lead.engine === 1 ? '1 — New Purchase' : lead.engine === 2 ? '2 — Renewal/Win-Back' : undefined} />
              <Row label="Recording Date" value={lead.recordingDate} />
              <Row label="Renewal Target" value={lead.renewalTargetDate ? new Date(lead.renewalTargetDate).toLocaleDateString() : undefined} />
              <Row label="Effective Date" value={lead.effectiveDate ? new Date(lead.effectiveDate).toLocaleDateString() : undefined} />
              <Row label="Expiration Date" value={expirationDate ? `${expirationDate} (est.)` : undefined} />
            </Grid>

          </Grid>
        </Section>

        <Divider textAlign="center"><Typography variant="body1" color="text.secondary" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>PRODUCER WORKSHEET</Typography></Divider>


        {/* ══ ROW 2 · PRODUCER WORKSHEET (editable) ═════════════════════ */}
        {/* <Section title="Producer Worksheet (editable)" sx={{ bgcolor: 'transparent' }}>
        </Section> */}
        <Grid container spacing={{ xs: 2, md: 2.5 }} sx={{ mt: 0.5, alignItems: 'stretch', '& > .MuiGrid-root': { border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, bgcolor: 'background.paper' } }}>

          {/* Insured Details (editable) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <SubHead>Insured Details</SubHead>
            {/* Skip trace (REAPI) — enabled for Grade A/B/C leads not yet traced (Frank Jun-2026) */}
            {lead.skipTraced ? (
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1, mb: 0.5 }}>
                <Chip size="small" color="success" variant="outlined" icon={<PersonSearchIcon />}
                  label={`Skip traced${lead.skipTracedAt ? ` · ${new Date(lead.skipTracedAt).toLocaleDateString()}` : ''}`} />
                {lead.skipTraceData && (
                  <Button size="small" variant="outlined" startIcon={<PersonSearchIcon />} onClick={() => setSkipDialogOpen(true)}>
                    View Skip Trace
                  </Button>
                )}
              </Stack>
            ) : (['A', 'B', 'C'].includes(String(lead.manualGrade || lead.grade))) ? (
              <Button
                variant="outlined" size="small"
                startIcon={skipTracing ? <CircularProgress size={14} color="inherit" /> : <PersonSearchIcon />}
                onClick={runSkipTraceAction}
                disabled={skipTracing}
                sx={{ mt: 1, mb: 0.5 }}
              >
                {skipTracing ? 'Tracing…' : 'Run Skip Trace'}
              </Button>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 0.5 }}>
                Skip trace is available on Grade A, B, or C leads.
              </Typography>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, mb: 1 }}>
              <TextField label="Co-Insured First" size="small" fullWidth value={extra.owner2FirstName ?? ''} onChange={(e) => setEx('owner2FirstName', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} placeholder="spouse / co-borrower" />
              <TextField label="Co-Insured Last" size="small" fullWidth value={extra.owner2LastName ?? ''} onChange={(e) => setEx('owner2LastName', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Box sx={{ mb: 1.7 }}>
              <FeatureSelect label="Married / Single" value={extra.maritalStatus ?? ''} onChange={(v) => setEx('maritalStatus', v)}
                options={[['married', 'Married (M)'], ['single', 'Single (S)']]} />
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.7 }}>
              <TextField label="Phone" size="small" fullWidth value={extra.phone1 ?? ''} onChange={(e) => setEx('phone1', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} placeholder="skip-trace / call" />
              <TextField label="Email" size="small" fullWidth value={extra.email1 ?? ''} onChange={(e) => setEx('email1', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: isAdmin ? 1 : 1.7 }}>
              DOB (skip-trace estimate) shows read-only under Account Data → Insured. Phone is a required Travelers portal field and drives the insurance score.
            </Typography>
            {isAdmin && (
              <Box sx={{ mb: 1.7, p: 1.25, borderRadius: 1, border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                  Admin override — correct a wrong skip-trace DOB (year drives the estimate)
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField label="Insured DOB (REAPI)" type="date" size="small" fullWidth value={extra.reapiDob ?? ''}
                    onChange={(e) => setEx('reapiDob', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField label="Co-Insured DOB" type="date" size="small" fullWidth value={extra.owner2Dob ?? ''}
                    onChange={(e) => setEx('owner2Dob', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Stack>
              </Box>
            )}
            <Box sx={{ mb: 1 }}>
              <FeatureSelect label="Insurance History" value={extra.insuranceHistory ?? ''} onChange={(v) => setEx('insuranceHistory', v)}
                options={[['currently_insured', 'Currently insured (assumed)'], ['lapsed', 'Lapsed'], ['new', 'New / first-time']]} />
            </Box>
          </Grid>

          {/* Grade Review */}
          <Grid size={{ xs: 12, md: 6 }}>
            <SubHead>Grade Review</SubHead>
            <Stack spacing={1.5} sx={{ mt: 0.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip label={`Grade ${lead.grade ?? '?'}`} sx={gradeChipSx(lead.grade)} size="small" />
                {lead.manualGrade && (
                  <Chip label="Manual override" color="secondary" size="small" variant="outlined" />
                )}
              </Stack>

              {lead.grade && lead.grade !== 'A' && gradeInfo && (
                <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: gradeInfo.backgroundColor, border: '1px solid', borderColor: gradeInfo.borderColor }}>
                  {missingFields.length > 0 ? (
                    <>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: gradeInfo.color }}>
                        Missing for Grade A ({missingFields.length})
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {missingFields.map((f) => (
                          <Chip key={f} label={f} size="small" variant="outlined"
                            sx={{ color: gradeInfo.color, borderColor: gradeInfo.borderColor, bgcolor: 'transparent' }} />
                        ))}
                      </Box>
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">All quote-ready fields present.</Typography>
                  )}
                  {lead.grade === 'D' && ineligibleReasons.length > 0 && (
                    <Box sx={{ mt: missingFields.length > 0 ? 1 : 0 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: gradeInfo.color, display: 'block' }}>
                        Ineligible — carrier appetite
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2 }}>
                        {ineligibleReasons.map((r, i) => (
                          <Typography key={i} component="li" variant="caption" color="text.secondary">{r}</Typography>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              )}

              <FormControl size="small" fullWidth>
                <InputLabel>Manual Grade Override</InputLabel>
                <Select value={manualGrade} label="Manual Grade Override" onChange={(e) => setManualGrade(e.target.value)}>
                  <MenuItem value="">(no override — use computed)</MenuItem>
                  <MenuItem value="A">A — Quote-ready</MenuItem>
                  <MenuItem value="B">B — Needs info (1 field)</MenuItem>
                  <MenuItem value="C">C — Needs info (2+ fields)</MenuItem>
                  <MenuItem value="D">D — Discard / quarantine</MenuItem>
                </Select>
              </FormControl>

              {manualGrade && (
                <TextField
                  label="Reason for Producer Manual Override *"
                  value={gradeOverrideReason}
                  onChange={(e) => setGradeOverrideReason(e.target.value)}
                  size="small" fullWidth multiline rows={2}
                  required
                  error={!gradeOverrideReason}
                  helperText={!gradeOverrideReason ? 'Required — a comment is needed to save a grade override.' : ' '}
                  placeholder="e.g. Roof age confirmed 2019 on call — upgrade B→A"
                />
              )}
              {lead.gradeOverrideAt && (
                <Typography variant="caption" color="text.secondary">
                  Overridden {new Date(lead.gradeOverrideAt).toLocaleString()}
                  {lead.gradeOverrideBy ? ` · ${lead.gradeOverrideBy}` : ''}
                </Typography>
              )}

              {/* Phase 5b: roof, DOB, insurance history, dog, baths, heating relocated.
                    Grade Review now shows only: override + reason + effective date. */}
              <Divider sx={{ my: 0.5 }} />
              <TextField label="Effective Date" type="date" size="small" fullWidth value={extra.effectiveDate ?? ''}
                onChange={(e) => setEx('effectiveDate', e.target.value)} slotProps={{ inputLabel: { shrink: true } }}
                helperText="New purchase ≈ 90 days from sale · Renewal = x-date − 90 days" />
            </Stack>
          </Grid>

          {/* Carrier Pricing (indicative) */}
          <Grid size={{ xs: 12, md: 6 }}>
            <SubHead>Carrier Pricing (indicative)</SubHead>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Enter the indicative band you ran in each portal. The cheaper carrier is auto-assigned to this lead.
            </Typography>
            {(() => {
              const t = parseFloat(extra.travelersPremium); const p = parseFloat(extra.plymouthPremium);
              const tOk = !isNaN(t); const pOk = !isNaN(p);
              const winner = tOk && pOk ? (t <= p ? 'travelers' : 'plymouth') : tOk ? 'travelers' : pOk ? 'plymouth' : null;
              const boxSx = (who: string) => ({
                p: 1, borderRadius: 1, border: '1px solid',
                borderColor: winner === who ? 'success.main' : 'divider',
                bgcolor: winner === who ? 'success.50' : 'transparent',
              });
              return (
                <Stack spacing={1.25}>
                  <Box sx={boxSx('travelers')}>
                    <TextField label={`Travelers $${winner === 'travelers' ? '  ✓ assigned' : ''}`} type="number" size="small" fullWidth
                      value={extra.travelersPremium ?? ''} onChange={(e) => setEx('travelersPremium', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }} placeholder="e.g. 2800" />
                  </Box>
                  <Box sx={boxSx('plymouth')}>
                    <TextField label={`Plymouth Rock $${winner === 'plymouth' ? '  ✓ assigned' : ''}`} type="number" size="small" fullWidth
                      value={extra.plymouthPremium ?? ''} onChange={(e) => setEx('plymouthPremium', e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }} placeholder="e.g. 2500" />
                  </Box>
                  {winner && (
                    <Alert severity="success" sx={{ py: 0, fontSize: 12 }}>
                      Carrier Assigned: <strong>{winner === 'travelers' ? 'Travelers' : 'Plymouth Rock'}</strong>
                      {tOk && pOk && t !== p && ` — cheaper by ${fmtCurrency(Math.abs(t - p))}`}
                    </Alert>
                  )}

                  {/* Indicative Band Price — merged into the outreach email. */}
                  {(() => {
                    const s = suggestBand(tOk ? t : undefined, pOk ? p : undefined);
                    const applySuggestion = () => {
                      if (!s) return;
                      setEx('indicativeBandLow', String(s.low));
                      setEx('indicativeBandHigh', String(s.high));
                    };
                    const lowSet = (extra.indicativeBandLow ?? '') !== '';
                    const highSet = (extra.indicativeBandHigh ?? '') !== '';
                    return (
                      <Box sx={{ p: 1, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
                          Indicative Band Price — merged into the outreach email
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <TextField label="Band Low $" type="number" size="small" fullWidth
                            value={extra.indicativeBandLow ?? ''} onChange={(e) => setEx('indicativeBandLow', e.target.value)}
                            slotProps={{ inputLabel: { shrink: true } }} placeholder="725" />
                          <TextField label="Band High $" type="number" size="small" fullWidth
                            value={extra.indicativeBandHigh ?? ''} onChange={(e) => setEx('indicativeBandHigh', e.target.value)}
                            slotProps={{ inputLabel: { shrink: true } }} placeholder="900" />
                        </Stack>
                        {s ? (
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75, flexWrap: 'wrap' }}>
                            <Typography variant="caption" color="text.secondary">
                              Suggested from rated pricing: <strong>${s.low.toLocaleString()} – ${s.high.toLocaleString()}</strong>
                            </Typography>
                            <Button size="small" onClick={applySuggestion} sx={{ textTransform: 'none', py: 0 }}>
                              {lowSet || highSet ? 'Reset to suggestion' : 'Use suggestion'}
                            </Button>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                            Enter Travelers / Plymouth indicative pricing above and a band will be suggested.
                          </Typography>
                        )}
                      </Box>
                    );
                  })()}
                </Stack>
              );
            })()}
            {varDiff != null && (
              <>
                <Divider sx={{ my: 1 }} />
                <Row label="Bound Premium" value={<Typography color={varDiff >= 0 ? 'success.main' : 'error.main'} sx={{ fontWeight: 700 }}>{fmtCurrency(lead.boundPremium)}</Typography>} />
                <Row label="Variance" value={
                  <Tooltip title="Bound minus indicative expected">
                    <Typography variant="body2" color={varDiff >= 0 ? 'success.main' : 'error.main'} sx={{ fontWeight: 700 }}>
                      {varDiff >= 0 ? '+' : ''}{fmtCurrency(varDiff)} ({varDiff >= 0 ? '+' : ''}{Math.round((varDiff / lead.expectedPremium) * 100)}%)
                    </Typography>
                  </Tooltip>
                } />
                {lead.varianceReason && <Row label="Variance Reason" value={lead.varianceReason} />}
              </>
            )}
          </Grid>

          {/* Flood Zone Override */}
          <Grid size={{ xs: 12, md: 6 }}>
            <SubHead>Flood Zone Override</SubHead>
            <FormControlLabel
              control={<Checkbox size="small" checked={!!extra.floodZoneManual} onChange={(e) => setEx('floodZoneManual', e.target.checked)} />}
              label={<Typography variant="body2">Manually override FEMA flood zone</Typography>}
            />
            {extra.floodZoneManual && (
              <FeatureSelect label="Flood Zone" value={extra.floodZoneType ?? ''} onChange={(v) => setEx('floodZoneType', v)}
                options={[['X', 'X — minimal risk'], ['X500', 'X (shaded) — 0.2% / moderate'], ['AE', 'AE — SFHA'], ['A', 'A — SFHA'], ['AH', 'AH — SFHA'], ['AO', 'AO — SFHA'], ['AR', 'AR — SFHA'], ['VE', 'VE — coastal SFHA'], ['V', 'V — coastal SFHA']]} />
            )}
          </Grid>

          {/* Property Details — Home Features & QC */}
          <Grid size={{ xs: 12 }}>
            <SubHead>Property Details — Home Features & QC</SubHead>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              All editable for QC — flag REAPI inaccuracies or record info confirmed on the call.
              Source from a listing (Zillow / Realtor.com). Heat defaults to gas for NJ.
            </Typography>
            <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: extra.propertyTypeMismatch ? '#fff3d6' : 'transparent', border: extra.propertyTypeMismatch ? '1px solid #eac36a' : '1px solid transparent' }}>
              <FormControlLabel
                control={<Checkbox size="small" checked={!!extra.propertyTypeMismatch} onChange={(e) => setEx('propertyTypeMismatch', e.target.checked)} />}
                label={<Typography variant="body2">Property type looks wrong (CRM says <strong>{lead.propertyType ?? '—'}</strong>, but it's actually a different type — verify on Zillow/Redfin)</Typography>}
              />
            </Box>
            {isCondoLead && !showCondoFields ? (
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: '#eef7f0', border: '1px solid #cfe6d5' }}>
                <Typography variant="body2" sx={{ color: '#2e5540' }}>
                  <strong>Condo</strong> — carriers don&apos;t rate condos on roof, garage, bath/kitchen, foundation, or other home characteristics, so these fields are hidden to keep entry quick. Contact info, eligibility, and the type-mismatch flag above still apply.
                </Typography>
                <Button size="small" onClick={() => setShowCondoFields(true)} sx={{ mt: 0.5, textTransform: 'none' }}>Show all fields anyway</Button>
              </Box>
            ) : (
              <>
                {isCondoLead && (
                  <Button size="small" onClick={() => setShowCondoFields(false)} sx={{ mb: 1, textTransform: 'none' }}>Hide condo-N/A fields</Button>
                )}
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Garage Type" value={extra.garageType ?? ''} onChange={(v) => setEx('garageType', v)}
                  options={[['attached', 'Attached'], ['built_in', 'Built-in (living space above)'], ['detached', 'Detached'], ['carport', 'Carport'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <TextField label="# Garages" type="number" size="small" fullWidth value={extra.garageCount ?? ''}
                  onChange={(e) => setEx('garageCount', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Foundation" value={extra.foundationType ?? ''} onChange={(v) => setEx('foundationType', v)}
                  options={[['basement', 'Basement'], ['crawl_space', 'Crawl space'], ['slab', 'Slab']]} />
              </Grid>
              {extra.foundationType === 'basement' && (
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextField label="Basement % Complete" size="small" fullWidth value={extra.basementFinishedPct ?? ''}
                    onChange={(e) => setEx('basementFinishedPct', e.target.value)} placeholder="e.g. 75%" slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Siding Type" value={extra.sidingType ?? ''} onChange={(v) => setEx('sidingType', v)}
                  options={[['vinyl', 'Vinyl'], ['wood', 'Wood'], ['brick', 'Brick'], ['stucco', 'Stucco'], ['fiber_cement', 'Fiber cement'], ['aluminum', 'Aluminum'], ['stone', 'Stone'], ['other', 'Other']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Primary Heat" value={extra.heatSource ?? 'gas'} onChange={(v) => setEx('heatSource', v)}
                  options={[['gas', 'Gas'], ['oil', 'Oil'], ['electric', 'Electric'], ['propane', 'Propane'], ['heat_pump', 'Heat pump'], ['other', 'Other']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <TextField label="Feet from Hydrant" type="number" size="small" fullWidth value={extra.feetFromHydrant ?? ''}
                  onChange={(e) => setEx('feetFromHydrant', e.target.value)} placeholder="e.g. 50" slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Dog Breed (restricted)" value={extra.dogBreed ?? ''} onChange={(v) => setEx('dogBreed', v)}
                  options={[['none', 'None / not restricted'], ...RESTRICTED_DOG_BREEDS.map((b) => [b, b] as [string, string])]} />
              </Grid>
            </Grid>
            {extra.dogBreed && extra.dogBreed !== 'none' && (
              <Alert severity="warning" sx={{ mt: 1, py: 0, fontSize: 12 }}>
                Restricted breed (Travelers Q#7) — may impact eligibility. Confirm with underwriting.
              </Alert>
            )}

            <Divider textAlign="left" sx={{ my: 1.5 }}>
              <Typography variant="caption" color="text.secondary">PROTECTIVE DEVICES</Typography>
            </Divider>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Burglar Alarm" value={extra.burglarAlarm ?? ''} onChange={(v) => setEx('burglarAlarm', v)}
                  options={[['local', 'Local'], ['smart', 'Smart'], ['central', 'Central'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Fire Alarm" value={extra.fireAlarm ?? ''} onChange={(v) => setEx('fireAlarm', v)}
                  options={[['local', 'Local'], ['central', 'Central'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Smoke Detector" value={extra.smokeDetector ?? ''} onChange={(v) => setEx('smokeDetector', v)}
                  options={[['regular', 'Regular'], ['smart', 'Smart'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Water Sensor" value={extra.waterSensor ?? ''} onChange={(v) => setEx('waterSensor', v)}
                  options={[['regular', 'Regular'], ['smart', 'Smart'], ['central', 'Central'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Auto Water Shutoff" value={extra.autoWaterShutoff ?? ''} onChange={(v) => setEx('autoWaterShutoff', v)}
                  options={[['regular', 'Regular'], ['smart', 'Smart'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FeatureSelect label="Low Temp Sensor" value={extra.lowTempSensor ?? ''} onChange={(v) => setEx('lowTempSensor', v)}
                  options={[['regular', 'Regular'], ['smart', 'Smart'], ['central', 'Central'], ['none', 'None']]} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FormControlLabel control={<Checkbox size="small" checked={!!extra.sprinklerSystem} onChange={(e) => setEx('sprinklerSystem', e.target.checked)} />} label="Sprinkler System" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <FormControlLabel control={<Checkbox size="small" checked={!!extra.leedCertified} onChange={(e) => setEx('leedCertified', e.target.checked)} />} label="LEED Certified Home" />
              </Grid>
            </Grid>

            <Divider textAlign="left" sx={{ my: 1.5 }}>
              <Typography variant="caption" color="text.secondary">HOME UPGRADES</Typography>
            </Divider>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <TextField label="Full Baths" type="number" size="small" fullWidth value={extra.bathroomsFull ?? ''}
                  onChange={(e) => setEx('bathroomsFull', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <TextField label="Half Baths" type="number" size="small" fullWidth value={extra.bathroomsHalf ?? ''}
                  onChange={(e) => setEx('bathroomsHalf', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4, md: 6 }}>
                <TextField label="Bathroom Grade" size="small" fullWidth value={extra.bathroomGrade ?? ''}
                  onChange={(e) => setEx('bathroomGrade', e.target.value)} placeholder="Builders Grade / Semi-Custom / Custom / Designer" slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <TextField label="# Kitchens" type="number" size="small" fullWidth value={extra.kitchenCount ?? ''}
                  onChange={(e) => setEx('kitchenCount', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 8, md: 6 }}>
                <TextField label="Kitchen Grade" size="small" fullWidth value={extra.kitchenGrade ?? ''}
                  onChange={(e) => setEx('kitchenGrade', e.target.value)} placeholder="Builders Grade / Semi-Custom / Custom / Designer" slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <TextField label="Heating Renovated (year)" type="number" size="small" fullWidth value={extra.heatingRenovatedYear ?? ''}
                  onChange={(e) => setEx('heatingRenovatedYear', e.target.value)} placeholder="e.g. 2018" slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
            </Grid>

            <Divider textAlign="left" sx={{ my: 1.5 }}>
              <Typography variant="caption" color="text.secondary">ROOF</Typography>
            </Divider>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField label="Roof Year" type="number" value={roofYear} onChange={(e) => setRoofYear(e.target.value)} size="small" fullWidth placeholder="e.g. 2019" slotProps={{ inputLabel: { shrink: true } }} />
              <FormControl size="small" fullWidth>
                <InputLabel>Roof Type</InputLabel>
                <Select value={roofType} label="Roof Type" onChange={(e) => setRoofType(e.target.value)}>
                  <MenuItem value="">Unknown</MenuItem>
                  <MenuItem value="Asphalt Shingle">Asphalt Shingle</MenuItem>
                  <MenuItem value="Architectural Shingle">Architectural Shingle</MenuItem>
                  <MenuItem value="Metal (Standing Seam)">Metal (Standing Seam)</MenuItem>
                  <MenuItem value="Slate">Slate</MenuItem>
                  <MenuItem value="Flat Metal">Flat Metal ⚠</MenuItem>
                  <MenuItem value="Tile">Tile ⚠</MenuItem>
                  <MenuItem value="Wood Shake">Wood Shake ⚠</MenuItem>
                  <MenuItem value="Other">Other</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Confirming roof year clears the B/C roof-age gate (homes &gt;15 yrs). Flat-metal, tile and wood are carrier-ineligible.
            </Typography>
            {['Flat Metal', 'Tile', 'Wood Shake'].includes(roofType) && (
              <Alert severity="warning" sx={{ py: 0, fontSize: 12 }}>
                High-risk roof type — both carriers ineligible (grade D).
              </Alert>
            )}
              </>
            )}
          </Grid>

          {/* Producer Workflow */}
          <Grid size={{ xs: 12 }}>
            <SubHead>Producer Workflow</SubHead>
            <Grid container spacing={2} sx={{ mt: 1.5 }}>
              {/* POS Quote # removed (Frank Phase 5b). Carrier is auto-assigned from the cheaper indicative price. */}
              <Grid size={{ xs: 12, sm: 6 }}>
                {(() => {
                  const t = parseFloat(extra.travelersPremium); const p = parseFloat(extra.plymouthPremium);
                  const tOk = !isNaN(t); const pOk = !isNaN(p);
                  const winner = tOk && pOk ? (t <= p ? 'Travelers' : 'Plymouth Rock') : tOk ? 'Travelers' : pOk ? 'Plymouth Rock' : null;
                  return (
                    <Box sx={{ p: 1, borderRadius: 1, border: '1px solid', borderColor: winner ? 'success.main' : 'divider', bgcolor: winner ? 'success.50' : 'transparent', height: '100%' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Carrier Assigned (cheaper indicative)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{winner ?? '— enter Travelers / PM indicative pricing first'}</Typography>
                    </Box>
                  );
                })()}
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Lead Status</InputLabel>
                  <Select value={status} label="Lead Status" onChange={(e) => setStatus(e.target.value)}>
                    {LEAD_STATUS_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="POS Quote Premium ($)"
                  value={posQuotePremium}
                  onChange={(e) => setPosQuotePremium(e.target.value)}
                  size="small" fullWidth type="number"
                  placeholder="Actual carrier quote amount"
                  slotProps={{ input: { startAdornment: <Typography color="text.secondary" sx={{ mr: 0.5 }}>$</Typography> } }}
                />
              </Grid>


              {/* POS vs indicative variance preview */}
              {posQuotePremium && lead?.expectedPremium && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <Alert severity={parseFloat(posQuotePremium) > lead.expectedPremium ? 'warning' : 'success'} sx={{ py: 0, fontSize: 12 }}>
                    POS vs indicative: {parseFloat(posQuotePremium) > lead.expectedPremium ? '+' : ''}
                    {fmtCurrency(parseFloat(posQuotePremium) - lead.expectedPremium)}
                    {' '}({Math.round(((parseFloat(posQuotePremium) - lead.expectedPremium) / lead.expectedPremium) * 100)}%)
                  </Alert>
                </Grid>
              )}

              {/* Authorization method + one-click date stamp — visible when status >= qualified */}
              {['qualified', 'quote_sent', 'bound'].includes(status) && (
                <Grid size={12}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>Authorization Method</InputLabel>
                      <Select value={authorizationMethod} label="Authorization Method" onChange={(e) => setAuthorizationMethod(e.target.value)}>
                        <MenuItem value="">(not recorded)</MenuItem>
                        <MenuItem value="verbal">Verbal — phone call</MenuItem>
                        <MenuItem value="web">Web — online opt-in</MenuItem>
                        <MenuItem value="email">Email — written consent</MenuItem>
                      </Select>
                    </FormControl>

                    {/* Authorization date stamp */}
                    {authorizationDate ? (
                      <Alert severity="success" icon={<GavelIcon fontSize="small" />} sx={{ py: 0.5, fontSize: 12, flex: 1 }}>
                        Authorized on {new Date(authorizationDate).toLocaleString()}
                      </Alert>
                    ) : (
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={stampingAuth ? <CircularProgress size={14} color="inherit" /> : <GavelIcon />}
                        onClick={stampAuthDate}
                        disabled={stampingAuth}
                        sx={{ flexShrink: 0 }}
                      >
                        {stampingAuth ? 'Stamping…' : 'Mark Authorized (now)'}
                      </Button>
                    )}
                  </Stack>
                </Grid>
              )}

              <Grid size={12}>
                <Divider textAlign="center"><Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>Bound / Variance Tracking</Typography></Divider>
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Bound Premium ($)"
                  value={boundPremium}
                  onChange={(e) => setBoundPremium(e.target.value)}
                  size="small" fullWidth type="number"
                  slotProps={{ input: { startAdornment: <Typography color="text.secondary" sx={{ mr: 0.5 }}>$</Typography> } }}
                />
              </Grid>

              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Variance Reason</InputLabel>
                  <Select value={varianceReason} label="Variance Reason" onChange={(e) => setVarianceReason(e.target.value)}>
                    <MenuItem value="">(none)</MenuItem>
                    <MenuItem value="roof_age">Roof Age / Condition</MenuItem>
                    <MenuItem value="prior_claims">Prior Claims History</MenuItem>
                    <MenuItem value="construction_type">Construction Type</MenuItem>
                    <MenuItem value="coastal_surcharge">Coastal Surcharge Applied</MenuItem>
                    <MenuItem value="credit_score">Credit Score Impact</MenuItem>
                    <MenuItem value="deductible_change">Deductible Changed</MenuItem>
                    <MenuItem value="coverage_change">Coverage Adjusted</MenuItem>
                    <MenuItem value="underwriting_adjustment">Underwriting Adjustment</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {boundPremium && lead?.expectedPremium && (
                <Grid size={12}>
                  <Alert severity={parseFloat(boundPremium) > lead.expectedPremium ? 'info' : 'success'} sx={{ py: 0, fontSize: 12 }}>
                    Variance: {parseFloat(boundPremium) > lead.expectedPremium ? '+' : ''}
                    {fmtCurrency(parseFloat(boundPremium) - lead.expectedPremium)} vs indicative expected ({fmtCurrency(lead.expectedPremium)})
                  </Alert>
                </Grid>
              )}

              <Grid size={12}>
                <TextField
                  label="Variance Notes"
                  value={varianceNotes}
                  onChange={(e) => setVarianceNotes(e.target.value)}
                  size="small" fullWidth multiline rows={2}
                  placeholder="Explain why bound premium differs from indicative..."
                />
              </Grid>

              {/* Lost reason + stage — only shown when status = lost */}
              {status === 'lost' && (
                <Grid size={12}>
                  <Stack spacing={2}>
                    <Typography variant="caption" color="error" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Lost — Required Fields
                    </Typography>
                    <FormControl size="small" fullWidth required>
                      <InputLabel>Lost Reason *</InputLabel>
                      <Select value={lostReason} label="Lost Reason *" onChange={(e) => setLostReason(e.target.value)}>
                        <MenuItem value="">(select reason)</MenuItem>
                        <MenuItem value="price">Price — quote too high</MenuItem>
                        <MenuItem value="no_contact">No contact — could not reach</MenuItem>
                        <MenuItem value="not_authorized">Not authorized — declined to quote</MenuItem>
                        <MenuItem value="out_of_appetite">Out of appetite — carrier declined</MenuItem>
                        <MenuItem value="bought_elsewhere">Bought elsewhere — already has coverage</MenuItem>
                        <MenuItem value="not_interested">Not interested</MenuItem>
                        <MenuItem value="other">Other</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl size="small" fullWidth required>
                      <InputLabel>Lost at Stage *</InputLabel>
                      <Select value={lostStage} label="Lost at Stage *" onChange={(e) => setLostStage(e.target.value)}>
                        <MenuItem value="">(select stage)</MenuItem>
                        <MenuItem value="in_appetite">In-appetite — pre rating-complete</MenuItem>
                        <MenuItem value="rating_complete">Rating-complete — never contacted</MenuItem>
                        <MenuItem value="right_party">Right-party — could not reach decision-maker</MenuItem>
                        <MenuItem value="authorization">Authorization — reached, declined to quote</MenuItem>
                        <MenuItem value="quoted">Quoted — presented but did not bind</MenuItem>
                        <MenuItem value="unknown">Unknown</MenuItem>
                      </Select>
                    </FormControl>

                    {/* Lost-to-competitor price — what we're up against next year */}
                    <TextField
                      label="Competing Carrier"
                      value={competitorCarrier}
                      onChange={(e) => setCompetitorCarrier(e.target.value)}
                      size="small" fullWidth
                      placeholder="e.g. Geico, NJM, Allstate"
                    />
                    <TextField
                      label="Competitor Premium ($)"
                      value={competitorPremium}
                      onChange={(e) => setCompetitorPremium(e.target.value)}
                      size="small" fullWidth type="number"
                      placeholder="Their annual premium, if known"
                      slotProps={{ input: { startAdornment: <Typography color="text.secondary" sx={{ mr: 0.5 }}>$</Typography> } }}
                    />
                    {competitorPremium && lead?.expectedPremium && (
                      <Alert severity="info" sx={{ py: 0, fontSize: 12 }}>
                        We were {parseFloat(competitorPremium) < lead.expectedPremium ? 'higher' : 'lower'} by{' '}
                        {fmtCurrency(Math.abs(parseFloat(competitorPremium) - lead.expectedPremium))} vs our indicative expected
                      </Alert>
                    )}

                    {/* Mandatory close-out election (Frank Phase 5) */}
                    <Divider textAlign="left"><Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>CLOSE-OUT *</Typography></Divider>
                    <FormControl size="small" fullWidth required>
                      <InputLabel>Revisit election *</InputLabel>
                      <Select
                        label="Revisit election *"
                        value={revisitFlag ? 'revisit' : extra.doNotRevisit ? 'no_revisit' : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRevisitFlag(v === 'revisit');
                          setEx('doNotRevisit', v === 'no_revisit');
                        }}
                      >
                        <MenuItem value="">(select — required to close)</MenuItem>
                        <MenuItem value="revisit">Revisit later / next year</MenuItem>
                        <MenuItem value="no_revisit">Do Not Revisit</MenuItem>
                      </Select>
                    </FormControl>
                    {revisitFlag && (
                      <>
                        <TextField label="Revisit Date" type="date" value={revisitDate} onChange={(e) => setRevisitDate(e.target.value)} size="small" fullWidth slotProps={{ inputLabel: { shrink: true } }} />
                        <TextField label="Revisit Note" value={revisitNote} onChange={(e) => setRevisitNote(e.target.value)} size="small" fullWidth multiline rows={2} placeholder="Why revisit? e.g. renewal X-date, price not competitive this year" />
                      </>
                    )}
                  </Stack>
                </Grid>
              )}

              <Grid size={12}><Divider /></Grid>

              <Grid size={12}>
                <TextField
                  label="Producer Note (logged as activity)"
                  value={producerNote}
                  onChange={(e) => setProducerNote(e.target.value)}
                  size="small"
                  fullWidth
                  multiline
                  rows={2}
                  placeholder="Optional note to log with this save..."
                />
              </Grid>
            </Grid>
          </Grid>

        </Grid>

        {/* Action bar (end of Row 2) — Save (persists changes) and Next (open next lead) are independent.
              Save is disabled until a field changes; Next is disabled while there are unsaved changes. */}

        <Section title='' >
          <Box sx={{ mt: 2 }}>
            {saveBlocked && dirty && (
              <Alert severity="warning" sx={{ py: 0, fontSize: 12, mb: 1 }}>{saveBlockedMsg}</Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Tooltip title={!dirty ? 'No changes to save' : saveBlocked ? saveBlockedMsg : 'Save changes'}>
                <span style={{ flex: 1, display: 'flex' }}>
                  <Button
                    variant="contained"
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                    onClick={() => save(false)}
                    disabled={saving || !dirty || saveBlocked}
                    sx={{ flex: 1 }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={nextLeadId ? 'Open the next priority lead' : 'Back to the leads queue'}>
                <span style={{ flex: 1, display: 'flex' }}>
                  <Button
                    variant="outlined"
                    endIcon={<SkipNextIcon />}
                    onClick={() => router.push(nextLeadId ? `/leads/${nextLeadId}` : '/leads')}
                    sx={{ flex: 1 }}
                  >
                    Next
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Box>
        </Section>

        {/* ══ ACTIVITY LOG (full width) ═════════════════════════════════ */}
        {lead.activities?.length > 0 && (
          <Section title={`Activity Log (${lead.activities.length})`}>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {lead.activities.map((a: any) => {
                const det = Array.isArray(a.metadata?.changes) ? a.metadata.changes : [];
                return (
                  <Box key={a.id} sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1.5, py: 0.25 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      {det.length > 0 ? (
                        <Tooltip
                          arrow
                          placement="top-start"
                          title={
                            <Box sx={{ py: 0.25 }}>
                              {det.map((d: any, i: number) => (
                                <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                                  <strong>{d.field}:</strong> {d.from} → {d.to}
                                </Typography>
                              ))}
                            </Box>
                          }
                        >
                          <Typography variant="body2" sx={{ borderBottom: '1px dotted', borderColor: 'text.disabled', cursor: 'help' }}>
                            {a.content}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="body2">{a.content}</Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 2 }}>
                        {new Date(a.createdAt).toLocaleString()}
                        {a.createdBy ? ` · ${a.createdBy}` : ''}
                      </Typography>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Section>
        )}

      </Stack>

      <SkipTraceDialog
        open={skipDialogOpen}
        onClose={() => setSkipDialogOpen(false)}
        data={lead.skipTraceData}
        tracedAt={lead.skipTracedAt}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
