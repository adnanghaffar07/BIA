'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Box, Breadcrumbs, Button, Chip, CircularProgress, Divider, Grid,
  MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
  Alert, Snackbar, FormControl, InputLabel, Checkbox, FormControlLabel,
} from '@mui/material';
import Link from 'next/link';
import { getMissingFields } from '@/services/grade.service';
import { GRADE_INFO, LeadGrade } from '@/types/grade';
import { LEAD_STATUS_OPTIONS, leadStatusLabel, CLOSED_STATUSES, LeadStatus } from '@/types/lead';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeIcon from '@mui/icons-material/Home';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import WavesIcon from '@mui/icons-material/Waves';
import SaveIcon from '@mui/icons-material/Save';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import GavelIcon from '@mui/icons-material/Gavel';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, prefix = '') {
  if (v == null) return '—';
  return `${prefix}${Number(v).toLocaleString()}`;
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
    extreme:  { color: 'error',   label: '🔴 Extreme Coastal' },
    high:     { color: 'warning', label: '🟠 High Coastal' },
    moderate: { color: 'info',    label: '🟡 Moderate Coastal' },
    low:      { color: 'success', label: '🟢 Low Coastal Risk' },
  };
  const cfg = map[exposure] ?? { color: 'default' as any, label: exposure };
  return <Chip label={cfg.label} color={cfg.color} size="small" />;
}

function eligibilityIcon(status: string | null) {
  if (status === 'eligible')   return <CheckCircleIcon fontSize="small" color="success" />;
  if (status === 'ineligible') return <CancelIcon fontSize="small" color="error" />;
  return <HelpOutlineIcon fontSize="small" color="warning" />;
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, height: '100%' }}>
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
        doNotRevisit: !!l.doNotRevisit,
        phone1: l.phone1 ?? '',
        email1: l.email1 ?? '',
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

  const save = async (andNext = false) => {
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
    const bp  = boundPremium     ? parseFloat(boundPremium)     : undefined;
    const pqp = posQuotePremium  ? parseFloat(posQuotePremium)  : undefined;
    const varianceAmount = bp && lead?.expectedPremium
      ? Math.round((bp - lead.expectedPremium) * 10) / 10
      : undefined;

    const body: any = {
      status,
      posQuoteNumber:     posQuoteNumber     || undefined,
      posCarrier:         posCarrier         || undefined,
      posQuotePremium:    pqp,
      boundPremium:       bp,
      varianceNotes:      varianceNotes      || undefined,
      varianceReason:     varianceReason     || undefined,
      varianceAmount,
      authorizationMethod: authorizationMethod || undefined,
      lostReason:  status === 'lost' ? (lostReason  || undefined) : undefined,
      lostStage:   status === 'lost' ? (lostStage   || undefined) : undefined,
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
      _createdBy: lead?.producerEmail || undefined,
      _activityNote: producerNote || `Status updated to ${statusLabel(status)}`,
      _activityType: status === 'bound' ? 'bound' : status === 'lost' ? 'lost' : 'status_change',
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
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push('/leads')} sx={{ mt: 2 }}>Back to Leads</Button>
      </Box>
    );
  }

  const address = `${lead.addressStreet}, ${lead.addressCity}, ${lead.addressState} ${lead.addressZip}`;
  const ownerName = [lead.owner1FirstName, lead.owner1LastName].filter(Boolean).join(' ') || '—';

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

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link href="/queue" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          <ArrowBackIcon fontSize="small" /> Leads
        </Link>
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

      <Grid container spacing={2.5}>

        {/* ── LEFT: read-only data (2-up cards) + activity log ──────────── */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2.5}>
          <Grid container spacing={2.5}>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Insured Information">
              <Row label="Insured Named" value={ownerName} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1, mb: 1 }}>
                <TextField label="Co-Insured First" size="small" fullWidth value={extra.owner2FirstName ?? ''} onChange={(e) => setEx('owner2FirstName', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} placeholder="spouse / co-borrower" />
                <TextField label="Co-Insured Last" size="small" fullWidth value={extra.owner2LastName ?? ''} onChange={(e) => setEx('owner2LastName', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
              <Box sx={{ mb: 1 }}>
                <FeatureSelect label="Married / Single" value={extra.maritalStatus ?? ''} onChange={(v) => setEx('maritalStatus', v)}
                  options={[['married', 'Married (M)'], ['single', 'Single (S)']]} />
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField label="Phone" size="small" fullWidth value={extra.phone1 ?? ''} onChange={(e) => setEx('phone1', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} placeholder="skip-trace / call" />
                <TextField label="Email" size="small" fullWidth value={extra.email1 ?? ''} onChange={(e) => setEx('email1', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Row label="Owner Occupied" value={lead.ownerOccupied ? 'Yes' : 'No'} />
              <Row label="Absentee Owner" value={lead.absenteeOwner ? 'Yes' : 'No'} />
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Property Details">
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
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Financials">
              <Row label="Estimated Value" value={fmtCurrency(lead.estimatedValue)} />
              <Row label="Assessed Value" value={fmtCurrency(lead.assessedValue)} />
              <Row label="Last Sale" value={fmtCurrency(lead.lastSaleAmount)} />
              <Row label="Last Sale Date" value={lead.lastSaleDate} />
              <Row label="Open Mortgage" value={fmtCurrency(lead.openMortgageBalance)} />
              <Row label="Lender" value={lead.lenderName} />
              <Row label="Mortgage Type" value={lead.mortgageType} />
              <Row label="Est. Equity" value={fmtCurrency(lead.estimatedEquity)} />
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Carrier Eligibility">
              {/* Travelers */}
              <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }} spacing={1}>
                {eligibilityIcon(lead.travelersEligible)}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Travelers</Typography>
                <Chip label={lead.travelersEligible ?? 'unknown'} size="small" variant="outlined"
                  color={lead.travelersEligible === 'eligible' ? 'success' : lead.travelersEligible === 'ineligible' ? 'error' : 'warning'}
                />
              </Stack>
              {travelersNotes.length > 0 && (
                <Box sx={{ pl: 3.5, mb: 1.5 }}>
                  {travelersNotes.map((n, i) => (
                    <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>• {n}</Typography>
                  ))}
                </Box>
              )}

              <Divider sx={{ my: 1 }} />

              {/* Plymouth Rock */}
              <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }} spacing={1}>
                {eligibilityIcon(lead.plymouthEligible)}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Plymouth Rock</Typography>
                <Chip label={lead.plymouthEligible ?? 'unknown'} size="small" variant="outlined"
                  color={lead.plymouthEligible === 'eligible' ? 'success' : lead.plymouthEligible === 'ineligible' ? 'error' : 'warning'}
                />
              </Stack>
              {plymouthNotes.length > 0 && (
                <Box sx={{ pl: 3.5 }}>
                  {plymouthNotes.map((n, i) => (
                    <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>• {n}</Typography>
                  ))}
                </Box>
              )}
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Carrier Pricing (indicative)">
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
                        Assigned carrier: <strong>{winner === 'travelers' ? 'Travelers' : 'Plymouth Rock'}</strong>
                        {tOk && pOk && t !== p && ` — cheaper by ${fmtCurrency(Math.abs(t - p))}`}
                      </Alert>
                    )}
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
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Flood & Coastal Risk">
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
              <Divider sx={{ my: 1 }} />
              <FormControlLabel
                control={<Checkbox size="small" checked={!!extra.floodZoneManual} onChange={(e) => setEx('floodZoneManual', e.target.checked)} />}
                label={<Typography variant="body2">Manually override FEMA flood zone</Typography>}
              />
              {extra.floodZoneManual && (
                <FeatureSelect label="Flood Zone" value={extra.floodZoneType ?? ''} onChange={(v) => setEx('floodZoneType', v)}
                  options={[['X', 'X — minimal risk'], ['X500', 'X (shaded) — 0.2% / moderate'], ['AE', 'AE — SFHA'], ['A', 'A — SFHA'], ['AH', 'AH — SFHA'], ['AO', 'AO — SFHA'], ['AR', 'AR — SFHA'], ['VE', 'VE — coastal SFHA'], ['V', 'V — coastal SFHA']]} />
              )}
            </Section>
            </Grid>

            <Grid size={{ xs: 12, lg: 6 }}>
            <Section title="Pipeline">
              <Row label="Engine" value={lead.engine === 1 ? '1 — New Purchase' : lead.engine === 2 ? '2 — Renewal/Win-Back' : undefined} />
              <Row label="Recording Date" value={lead.recordingDate} />
              <Row label="Renewal Target" value={lead.renewalTargetDate ? new Date(lead.renewalTargetDate).toLocaleDateString() : undefined} />
              <Row label="Effective Date" value={lead.effectiveDate ? new Date(lead.effectiveDate).toLocaleDateString() : undefined} />
            </Section>
            </Grid>

            <Grid size={{ xs: 12 }}>
            <Section title="Property Details — Home Features & QC (editable)">
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                All editable for QC — flag REAPI inaccuracies or record info confirmed on the call.
                Source from a listing (Zillow / Realtor.com). Heat defaults to gas for NJ.
              </Typography>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <FeatureSelect label="Garage Type" value={extra.garageType ?? ''} onChange={(v) => setEx('garageType', v)}
                    options={[['attached', 'Attached'], ['detached', 'Detached'], ['none', 'None']]} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextField label="# Garages" type="number" size="small" fullWidth value={extra.garageCount ?? ''}
                    onChange={(e) => setEx('garageCount', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <FeatureSelect label="Foundation" value={extra.foundationType ?? ''} onChange={(v) => setEx('foundationType', v)}
                    options={[['basement', 'Basement'], ['crawl_space', 'Crawl space'], ['slab', 'Slab']]} />
                </Grid>
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
              </Grid>

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
            </Section>
            </Grid>

          </Grid>

          {lead.activities?.length > 0 && (
            <Section title={`Activity Log (${lead.activities.length})`}>
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {lead.activities.map((a: any) => (
                  <Box key={a.id} sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1.5, py: 0.25 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2">{a.content}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 2 }}>
                        {new Date(a.createdAt).toLocaleString()}
                        {a.createdBy ? ` · ${a.createdBy}` : ''}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Section>
          )}

          </Stack>
        </Grid>

        {/* ── RIGHT: producer actions (sticky rail) ─────────────────────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Box sx={{ position: { md: 'sticky' }, top: 16 }}>
          <Stack spacing={2}>

            <Section title="Grade Review">
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
                    label="Override Reason"
                    value={gradeOverrideReason}
                    onChange={(e) => setGradeOverrideReason(e.target.value)}
                    size="small" fullWidth multiline rows={2}
                    placeholder="e.g. Roof age confirmed 2019 on call — upgrade B→A"
                  />
                )}
                {lead.gradeOverrideAt && (
                  <Typography variant="caption" color="text.secondary">
                    Overridden {new Date(lead.gradeOverrideAt).toLocaleString()}
                    {lead.gradeOverrideBy ? ` · ${lead.gradeOverrideBy}` : ''}
                  </Typography>
                )}

                {/* Roof moved to "Property Details — Home Features & QC" (Frank Phase 5) */}

                {/* ── Insured & call-prep: confirm on first contact (Frank Jun-2026) ── */}
                <Divider textAlign="left">
                  <Typography variant="caption" color="text.secondary">INSURED & CALL PREP (confirm on call)</Typography>
                </Divider>
                <Typography variant="caption" color="text.secondary">
                  Insured names, phone & marital status are in the Insured Information box.
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField label="Owner 1 DOB" type="date" size="small" fullWidth value={extra.owner1Dob ?? ''}
                    onChange={(e) => setEx('owner1Dob', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField label="Owner 2 DOB" type="date" size="small" fullWidth value={extra.owner2Dob ?? ''}
                    onChange={(e) => setEx('owner2Dob', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  DOB + phone drive the Travelers insurance score (phone is a required portal field).
                </Typography>

                <FeatureSelect label="Dog Breed (restricted)" value={extra.dogBreed ?? ''} onChange={(v) => setEx('dogBreed', v)}
                  options={[['none', 'None / not restricted'], ...RESTRICTED_DOG_BREEDS.map((b) => [b, b] as [string, string])]} />
                {extra.dogBreed && extra.dogBreed !== 'none' && (
                  <Alert severity="warning" sx={{ py: 0, fontSize: 12 }}>
                    Restricted breed (Travelers Q#7) — may impact eligibility. Confirm with underwriting.
                  </Alert>
                )}

                <FeatureSelect label="Insurance History" value={extra.insuranceHistory ?? ''} onChange={(v) => setEx('insuranceHistory', v)}
                  options={[['currently_insured', 'Currently insured (assumed)'], ['lapsed', 'Lapsed'], ['new', 'New / first-time']]} />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField label="Full Baths" type="number" size="small" fullWidth value={extra.bathroomsFull ?? ''}
                    onChange={(e) => setEx('bathroomsFull', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField label="Half Baths" type="number" size="small" fullWidth value={extra.bathroomsHalf ?? ''}
                    onChange={(e) => setEx('bathroomsHalf', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Stack>

                <TextField label="Heating Renovated (year)" type="number" size="small" fullWidth value={extra.heatingRenovatedYear ?? ''}
                  onChange={(e) => setEx('heatingRenovatedYear', e.target.value)} placeholder="e.g. 2018" slotProps={{ inputLabel: { shrink: true } }} />

                <TextField label="Effective Date" type="date" size="small" fullWidth value={extra.effectiveDate ?? ''}
                  onChange={(e) => setEx('effectiveDate', e.target.value)} slotProps={{ inputLabel: { shrink: true } }}
                  helperText="New purchase ≈ 90 days from sale · Renewal = x-date − 90 days" />
              </Stack>
            </Section>

            <Section title="Producer Workflow">
              <Stack spacing={2} sx={{ mt: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Lead Status</InputLabel>
                  <Select value={status} label="Lead Status" onChange={(e) => setStatus(e.target.value)}>
                    {LEAD_STATUS_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField label="POS Quote #" value={posQuoteNumber} onChange={(e) => setPosQuoteNumber(e.target.value)} size="small" fullWidth />
                <TextField label="Carrier (POS)" value={posCarrier} onChange={(e) => setPosCarrier(e.target.value)} size="small" fullWidth placeholder="e.g. Travelers" />
                <TextField
                  label="POS Quote Premium ($)"
                  value={posQuotePremium}
                  onChange={(e) => setPosQuotePremium(e.target.value)}
                  size="small" fullWidth type="number"
                  placeholder="Actual carrier quote amount"
                  slotProps={{ input: { startAdornment: <Typography color="text.secondary" sx={{ mr: 0.5 }}>$</Typography> } }}
                />

                {/* POS vs indicative variance preview */}
                {posQuotePremium && lead?.expectedPremium && (
                  <Alert severity={parseFloat(posQuotePremium) > lead.expectedPremium ? 'warning' : 'success'} sx={{ py: 0, fontSize: 12 }}>
                    POS vs indicative: {parseFloat(posQuotePremium) > lead.expectedPremium ? '+' : ''}
                    {fmtCurrency(parseFloat(posQuotePremium) - lead.expectedPremium)}
                    {' '}({Math.round(((parseFloat(posQuotePremium) - lead.expectedPremium) / lead.expectedPremium) * 100)}%)
                  </Alert>
                )}

                <Divider />

                {/* Authorization method + one-click date stamp — visible when status >= qualified */}
                {['qualified', 'quote_sent', 'bound'].includes(status) && (
                  <>
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
                      <Alert severity="success" icon={<GavelIcon fontSize="small" />} sx={{ py: 0.5, fontSize: 12 }}>
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
                        fullWidth
                      >
                        {stampingAuth ? 'Stamping…' : 'Mark Authorized (now)'}
                      </Button>
                    )}
                  </>
                )}

                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Bound / Variance Tracking
                </Typography>

                <TextField
                  label="Bound Premium ($)"
                  value={boundPremium}
                  onChange={(e) => setBoundPremium(e.target.value)}
                  size="small" fullWidth type="number"
                  slotProps={{ input: { startAdornment: <Typography color="text.secondary" sx={{ mr: 0.5 }}>$</Typography> } }}
                />

                {boundPremium && lead?.expectedPremium && (
                  <Alert severity={parseFloat(boundPremium) > lead.expectedPremium ? 'info' : 'success'} sx={{ py: 0, fontSize: 12 }}>
                    Variance: {parseFloat(boundPremium) > lead.expectedPremium ? '+' : ''}
                    {fmtCurrency(parseFloat(boundPremium) - lead.expectedPremium)} vs indicative expected ({fmtCurrency(lead.expectedPremium)})
                  </Alert>
                )}

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

                <TextField
                  label="Variance Notes"
                  value={varianceNotes}
                  onChange={(e) => setVarianceNotes(e.target.value)}
                  size="small" fullWidth multiline rows={2}
                  placeholder="Explain why bound premium differs from indicative..."
                />

                {/* Lost reason + stage — only shown when status = lost */}
                {status === 'lost' && (
                  <>
                    <Divider />
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
                  </>
                )}

                <Divider />

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

                <Stack direction="row" spacing={1}>
                  <Button
                    variant="outlined"
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                    onClick={() => save(false)}
                    disabled={saving}
                    sx={{ flex: 1 }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SkipNextIcon />}
                    onClick={() => save(true)}
                    disabled={saving || !nextLeadId}
                    sx={{ flex: 1 }}
                    title={nextLeadId ? 'Save and open the next priority lead' : 'No more active leads in queue'}
                  >
                    {saving ? 'Saving…' : 'Save & Next'}
                  </Button>
                </Stack>
              </Stack>
            </Section>

          </Stack>
          </Box>
        </Grid>

        {/* Activity Log now lives in the left column (above) so it fills the
            space beside the taller sticky actions rail. */}

      </Grid>

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
