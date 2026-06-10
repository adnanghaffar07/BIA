'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Box, Breadcrumbs, Button, Chip, CircularProgress, Divider, Grid,
  MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography,
  Alert, Snackbar, FormControl, InputLabel,
} from '@mui/material';
import Link from 'next/link';
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

function gradeColor(g: string | null) {
  switch (g) {
    case 'A': return 'success';
    case 'B': return 'info';
    case 'C': return 'warning';
    case 'D': return 'error';
    default:  return 'default';
  }
}

function statusLabel(s: string | null) {
  const map: Record<string, string> = {
    new: 'New', contacted: 'Contacted', qualified: 'Qualified',
    quote_sent: 'Quote Sent', bound: 'Bound', lost: 'Lost',
  };
  return map[s ?? ''] ?? s ?? 'New';
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
      <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 140 }}>{label}</Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 500, textAlign: 'right' }}>{value ?? '—'}</Typography>
    </Stack>
  );
}

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

  const varDiff = lead.boundPremium && lead.expectedPremium
    ? lead.boundPremium - lead.expectedPremium
    : null;

  const travelersNotes: string[] = typeof lead.travelersNotes === 'string'
    ? JSON.parse(lead.travelersNotes || '[]')
    : lead.travelersNotes ?? [];
  const plymouthNotes: string[] = typeof lead.plymouthNotes === 'string'
    ? JSON.parse(lead.plymouthNotes || '[]')
    : lead.plymouthNotes ?? [];

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
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip label={`Grade ${lead.grade ?? '?'}`} color={gradeColor(lead.grade) as any} />
          <Chip label={statusLabel(lead.status)} variant="outlined" />
          {coastChip(lead.coastExposure)}
        </Stack>
      </Stack>

      <Grid container spacing={2.5}>

        {/* ── Column 1: Property + Owner ────────────────────────────────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>

            <Section title="Property Details">
              <Row label="Owner" value={ownerName} />
              <Row label="Property Type" value={lead.propertyType} />
              <Row label="Land Use" value={lead.landUse} />
              <Row label="Year Built" value={lead.yearBuilt} />
              <Row label="Sq Ft" value={lead.squareFeet ? Number(lead.squareFeet).toLocaleString() : undefined} />
              <Row label="Bedrooms / Bath" value={`${lead.bedrooms ?? '—'} bd / ${lead.bathrooms ?? '—'} ba`} />
              <Row label="Stories" value={lead.stories} />
              <Row label="Lot Sq Ft" value={lead.lotSquareFeet ? Number(lead.lotSquareFeet).toLocaleString() : undefined} />
              <Row label="Pool" value={lead.pool ? 'Yes' : 'No'} />
              <Row label="Garage" value={lead.garage ? 'Yes' : 'No'} />
              <Row label="Basement" value={lead.basement ? 'Yes' : 'No'} />
              <Row label="A/C" value={lead.airConditioning ? 'Yes' : 'No'} />
            </Section>

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

          </Stack>
        </Grid>

        {/* ── Column 2: Carrier + Pricing ──────────────────────────────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>

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

            <Section title="Indicative Premium">
              <Row label="Low Estimate" value={fmtCurrency(lead.lowPremium)} />
              <Row label="Expected" value={
                <Typography variant="body2" color="primary" sx={{ fontWeight: 700 }}>
                  {fmtCurrency(lead.expectedPremium)}
                </Typography>
              } />
              <Row label="High Estimate" value={fmtCurrency(lead.highPremium)} />
              <Row label="Confidence" value={lead.pricingConfidence != null ? `${lead.pricingConfidence}%` : undefined} />
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

            <Section title="Coastal Exposure">
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
            </Section>

          </Stack>
        </Grid>

        {/* ── Column 3: Producer Workflow ───────────────────────────────── */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>

            <Section title="Pipeline">
              <Row label="Engine" value={lead.engine === 1 ? '1 — New Purchase' : lead.engine === 2 ? '2 — Renewal/Win-Back' : undefined} />
              <Row label="Recording Date" value={lead.recordingDate} />
              <Row label="Renewal Target" value={lead.renewalTargetDate ? new Date(lead.renewalTargetDate).toLocaleDateString() : undefined} />
              <Row label="Owner Occupied" value={lead.ownerOccupied ? 'Yes' : 'No'} />
              <Row label="Absentee Owner" value={lead.absenteeOwner ? 'Yes' : 'No'} />
              <Row label="Flood Zone" value={lead.floodZone ? `Yes — ${lead.floodZoneType ?? ''}` : 'No'} />
            </Section>

            <Section title="Producer Workflow">
              <Stack spacing={2} sx={{ mt: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Lead Status</InputLabel>
                  <Select value={status} label="Lead Status" onChange={(e) => setStatus(e.target.value)}>
                    <MenuItem value="new">New</MenuItem>
                    <MenuItem value="contacted">Contacted</MenuItem>
                    <MenuItem value="qualified">Qualified</MenuItem>
                    <MenuItem value="quote_sent">Quote Sent</MenuItem>
                    <MenuItem value="bound">Bound</MenuItem>
                    <MenuItem value="lost">Lost</MenuItem>
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
        </Grid>

        {/* ── Activity Log ─────────────────────────────────────────────── */}
        {lead.activities?.length > 0 && (
          <Grid size={12}>
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
          </Grid>
        )}

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
