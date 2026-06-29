'use client';

import { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Chip, CircularProgress, Container,
  Divider, Grid, Stack, Typography, Alert,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import GavelIcon from '@mui/icons-material/Gavel';
import HomeIcon from '@mui/icons-material/Home';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import StackedLineChartIcon from '@mui/icons-material/StackedLineChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  total: number;
  engine1: number;
  engine2: number;
  unassigned: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeD: number;
  inAppetite: number;
  ratingComplete: number;
  contactable: number;
  quoteReady: number;
  rightPartyContact: number;
  authorizedToQuote: number;
  quotedPos: number;
  bound: number;
  // stock health
  quoteReadyActive: number;
  workingStock: number;
  boundLast30: number;
  staleLeads: number;
  pastXDate: number;
  bufferDays: number | null;
  stockFlowRatio: number | null;
  dailyBurnRate: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(num: number, denom: number) {
  if (!denom) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

function cumPct(num: number, raw: number) {
  return pct(num, raw);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color, icon,
}: {
  label: string; value: number | string; sub?: string; color: string; icon: React.ReactNode;
}) {
  return (
    <Card sx={{ boxShadow: 2, borderTop: `4px solid ${color}`, height: '100%' }}>
      <CardContent sx={{ textAlign: 'center', py: 2.5 }}>
        <Box sx={{ color, mb: 0.5 }}>{icon}</Box>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color }}>
          {value}
        </Typography>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 0.5 }}>{label}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

function FunnelRow({
  stage, stepRate, cumulative, description, highlight,
}: {
  stage: string; stepRate: string; cumulative: string; description: string; highlight?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        // Mobile: stage + two chips on one line, description wraps to a full-width row.
        // Desktop: the original 4-column table layout.
        gridTemplateColumns: { xs: '1fr auto auto', md: '1.4fr 90px 90px 2fr' },
        columnGap: 2,
        rowGap: 0.5,
        alignItems: 'center',
        py: 1.25,
        px: { xs: 1.25, md: 2 },
        borderRadius: 1,
        bgcolor: highlight ? 'success.50' : 'transparent',
        ...(highlight && { border: '1px solid', borderColor: 'success.200' }),
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: highlight ? 700 : 400 }}>{stage}</Typography>
      <Chip label={stepRate} size="small" sx={{ fontWeight: 600, width: 'fit-content' }} color={highlight ? 'success' : 'default'} />
      <Chip label={cumulative} size="small" variant="outlined" sx={{ width: 'fit-content' }} />
      <Typography variant="caption" color="text.secondary" sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>{description}</Typography>
    </Box>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSummary(d.data);
        else setError(d.error || 'Failed to load dashboard');
      })
      .catch(() => setError('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !summary) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">{error ?? 'No data'}</Alert>
      </Container>
    );
  }

  const s = summary;

  // Funnel 1 step rates
  const f1StepInAppetite   = pct(s.inAppetite,     s.total);
  const f1StepRating       = pct(s.ratingComplete,  s.inAppetite);
  const f1StepContactable  = pct(s.contactable,     s.ratingComplete);

  // Funnel 2 step rates
  const f2StepRPC   = pct(s.rightPartyContact, s.quoteReady);
  const f2StepAuth  = pct(s.authorizedToQuote, s.rightPartyContact);
  const f2StepQuote = pct(s.quotedPos,         s.authorizedToQuote);
  const f2StepBound = pct(s.bound,             s.quotedPos);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 0.5 }}>Dashboard</Typography>
        <Typography variant="body1" color="text.secondary">
          Live pipeline counts — {s.total.toLocaleString()} total leads in DB
        </Typography>
      </Box>

      {/* ── Top KPI cards ───────────────────────────────────────────────────── */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Raw Records" value={s.total.toLocaleString()} sub="Total leads in DB" color="#2196f3" icon={<FileDownloadIcon sx={{ fontSize: 36 }} />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="In-Appetite" value={s.inAppetite.toLocaleString()} sub={`${pct(s.inAppetite, s.total)} of raw`} color="#ff9800" icon={<TrendingUpIcon sx={{ fontSize: 36 }} />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Quote-Ready" value={s.quoteReady.toLocaleString()} sub={`${cumPct(s.quoteReady, s.total)} of raw`} color="#4caf50" icon={<FactCheckIcon sx={{ fontSize: 36 }} />} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard label="Bound" value={s.bound.toLocaleString()} sub={`${pct(s.bound, s.quoteReady)} of quote-ready`} color="#9c27b0" icon={<GavelIcon sx={{ fontSize: 36 }} />} />
        </Grid>
      </Grid>

      {/* ── Stock Health ────────────────────────────────────────────────────── */}
      {(() => {
        const bufferColor   = s.bufferDays == null ? '#757575'
          : s.bufferDays < 7  ? '#c62828'
          : s.bufferDays < 14 ? '#e65100'
          : '#2e7d32';

        const ratioColor    = s.stockFlowRatio == null ? '#757575'
          : s.stockFlowRatio < 0.4 || s.stockFlowRatio > 1.0 ? '#e65100'
          : '#2e7d32';

        const bufferLabel   = s.bufferDays == null ? 'N/A — no binds yet'
          : `${s.bufferDays} days`;

        const ratioLabel    = s.stockFlowRatio == null ? 'N/A'
          : `${s.stockFlowRatio}×`;

        const ratioStatus   = s.stockFlowRatio == null ? null
          : s.stockFlowRatio >= 0.4 && s.stockFlowRatio <= 1.0 ? 'success' as const
          : 'warning' as const;

        const bufferStatus  = s.bufferDays == null ? null
          : s.bufferDays >= 14 ? 'success' as const
          : s.bufferDays >= 7  ? 'warning' as const
          : 'error' as const;

        return (
          <Card sx={{ boxShadow: 2, mb: 3, borderLeft: '5px solid #1565c0' }}>
            <CardContent sx={{ pb: '16px !important' }}>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }} spacing={1}>
                <StackedLineChartIcon sx={{ color: '#1565c0' }} />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Pipeline Health</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  Last 30 days · {s.boundLast30} bound · {s.dailyBurnRate}/day
                </Typography>
              </Stack>

              <Grid container spacing={2}>

                {/* Working stock */}
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, bgcolor: '#e3f2fd' }}>
                    <HourglassEmptyIcon sx={{ color: '#1565c0', mb: 0.5 }} />
                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#1565c0' }}>
                      {s.workingStock.toLocaleString()}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Leads In Progress</Typography>
                    <Typography variant="caption" color="text.secondary">
                      actively being worked
                    </Typography>
                  </Box>
                </Grid>

                {/* Accounts Quoted */}
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, bgcolor: '#e0f2f1' }}>
                    <FactCheckIcon sx={{ color: '#00897b', mb: 0.5 }} />
                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#00897b' }}>
                      {s.quotedPos.toLocaleString()}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Accounts Quoted</Typography>
                    <Typography variant="caption" color="text.secondary">full carrier quote produced</Typography>
                  </Box>
                </Grid>

                {/* Bound (last 30 days) */}
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, bgcolor: '#f3e5f5' }}>
                    <GavelIcon sx={{ color: '#6a1b9a', mb: 0.5 }} />
                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: '#6a1b9a' }}>
                      {s.boundLast30.toLocaleString()}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Bound</Typography>
                    <Typography variant="caption" color="text.secondary">
                      policies bound · last 30 days
                    </Typography>
                  </Box>
                </Grid>

                {/* Stale leads */}
                <Grid size={{ xs: 6, sm: 3 }}>
                  <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, bgcolor: s.staleLeads > 0 ? '#fff8e1' : '#e8f5e9' }}>
                    <WarningAmberIcon sx={{ color: s.staleLeads > 0 ? '#f57c00' : '#388e3c', mb: 0.5 }} />
                    <Typography variant="h4" sx={{ fontWeight: 'bold', color: s.staleLeads > 0 ? '#f57c00' : '#388e3c' }}>
                      {s.staleLeads.toLocaleString()}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Stale Leads</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Grade A · never contacted · &gt;14 days old
                    </Typography>
                  </Box>
                </Grid>

              </Grid>

              {/* Inline alerts */}
              <Stack spacing={1} sx={{ mt: 2 }}>
                {bufferStatus === 'error' && (
                  <Alert severity="error" icon={<WarningAmberIcon />} sx={{ py: 0.5 }}>
                    Almost out of leads ({bufferLabel}) — pull new leads now so the team doesn&apos;t run dry.
                  </Alert>
                )}
                {bufferStatus === 'warning' && (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    Running low on leads ({bufferLabel}) — schedule a new pull within the next 7 days.
                  </Alert>
                )}
                {ratioStatus === 'warning' && s.stockFlowRatio !== null && (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    Pipeline coverage {ratioLabel} is outside the 0.5–0.75× target.{' '}
                    {s.stockFlowRatio > 1.0 ? 'Too many leads in progress — the team may be falling behind.' : 'Too few leads in progress — the team may be idle between calls.'}
                  </Alert>
                )}
                {s.staleLeads > 0 && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    {s.staleLeads} lead{s.staleLeads > 1 ? 's' : ''} untouched for 14+ days.
                    {s.pastXDate > 0 && ` ${s.pastXDate} have already passed their renewal date — consider retiring them.`}
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        );
      })()}

      <Grid container spacing={3}>

        {/* ── Funnel 1 ────────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, xl: 6 }}>
          <Card sx={{ boxShadow: 2, height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                Funnel 1 — Sourcing
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Raw → Quote-Ready. Each row is share of the prior step; Cumulative is share of raw.
              </Typography>

              {/* Header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1.4fr 90px 90px 2fr', gap: 2, px: 2, pb: 0.5 }}>
                {['Stage', 'Step rate', 'Cumulative', 'What it means'].map((h) => (
                  <Typography key={h} variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</Typography>
                ))}
              </Box>
              <Divider sx={{ mb: 1 }} />

              <FunnelRow
                stage="Raw records pulled"
                stepRate="100%"
                cumulative="100%"
                description={`${s.total.toLocaleString()} REAPI public-records pull`}
              />
              <FunnelRow
                stage="In-appetite"
                stepRate={f1StepInAppetite}
                cumulative={cumPct(s.inAppetite, s.total)}
                description={`${s.inAppetite.toLocaleString()} pass ≥1 carrier (Grade A/B/C)`}
              />
              <FunnelRow
                stage="Rating-complete"
                stepRate={f1StepRating}
                cumulative={cumPct(s.ratingComplete, s.total)}
                description={`${s.ratingComplete.toLocaleString()} all critical fields present (Grade A)`}
              />
              <FunnelRow
                stage="Contactable"
                stepRate={f1StepContactable}
                cumulative={cumPct(s.contactable, s.total)}
                description={`${s.contactable.toLocaleString()} Grade A with phone or email`}
              />
              <FunnelRow
                stage="= Quote-ready lead"
                stepRate={cumPct(s.quoteReady, s.total)}
                cumulative={`${s.quoteReady.toLocaleString()} leads`}
                description="Handed to the producer queue"
                highlight
              />
            </CardContent>
          </Card>
        </Grid>

        {/* ── Funnel 2 ────────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, xl: 6 }}>
          <Card sx={{ boxShadow: 2, height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                Funnel 2 — Producer
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                Quote-Ready → Bound. Each row is share of the prior step; Cumulative is share of quote-ready.
              </Typography>

              {/* Header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1.4fr 90px 90px 2fr', gap: 2, px: 2, pb: 0.5 }}>
                {['Stage', 'Step rate', 'Cumulative', 'What it means'].map((h) => (
                  <Typography key={h} variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</Typography>
                ))}
              </Box>
              <Divider sx={{ mb: 1 }} />

              <FunnelRow
                stage="Quote-ready lead"
                stepRate="100%"
                cumulative="100%"
                description={`${s.quoteReady.toLocaleString()} in the producer queue`}
              />
              <FunnelRow
                stage="Right-party contact"
                stepRate={f2StepRPC}
                cumulative={cumPct(s.rightPartyContact, s.quoteReady)}
                description={`${s.rightPartyContact.toLocaleString()} decision-maker reached`}
              />
              <FunnelRow
                stage="Authorized to quote"
                stepRate={f2StepAuth}
                cumulative={cumPct(s.authorizedToQuote, s.quoteReady)}
                description={`${s.authorizedToQuote.toLocaleString()} homeowner said "quote me"`}
              />
              <FunnelRow
                stage="Quoted (POS)"
                stepRate={f2StepQuote}
                cumulative={cumPct(s.quotedPos, s.quoteReady)}
                description={`${s.quotedPos.toLocaleString()} full carrier quote produced`}
              />
              <FunnelRow
                stage="Bound"
                stepRate={f2StepBound}
                cumulative={cumPct(s.bound, s.quoteReady)}
                description={`${s.bound.toLocaleString()} policies issued`}
                highlight
              />
            </CardContent>
          </Card>
        </Grid>

        {/* ── Pipeline breakdown ──────────────────────────────────────────── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Grade Breakdown</Typography>
              <Stack spacing={1.5}>
                {[
                  { label: 'Grade A — Quote-Ready',         value: s.gradeA, color: '#2e7d32', sub: 'All fields + passes carrier' },
                  { label: 'Grade B — Minor gap',            value: s.gradeB, color: '#1565c0', sub: '1 missing field' },
                  { label: 'Grade C — Needs Information',   value: s.gradeC, color: '#f57c00', sub: '2+ missing fields' },
                  { label: 'Grade D — Out of Appetite',     value: s.gradeD, color: '#c62828', sub: 'Fails all carriers' },
                ].map(({ label, value, color, sub }) => (
                  <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, color }}>{label}</Typography>
                      <Typography variant="caption" color="text.secondary">{sub}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, color }}>{value.toLocaleString()}</Typography>
                      <Typography variant="caption" color="text.secondary">{pct(value, s.total)} of total</Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* ── Engine breakdown ────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Pipeline Engine</Typography>
              <Stack spacing={1.5}>
                {[
                  { label: 'Engine 1 — New Purchase',        value: s.engine1,    color: '#1565c0', icon: <HomeIcon sx={{ fontSize: 18 }} />, sub: 'Mortgage recorded ≤90 days ago' },
                  { label: 'Engine 2 — Renewal / Win-Back',  value: s.engine2,    color: '#6a1b9a', icon: <CheckCircleIcon sx={{ fontSize: 18 }} />, sub: 'Worked 60 days before renewal' },
                  { label: 'Unassigned',                      value: s.unassigned, color: '#757575', icon: <PersonSearchIcon sx={{ fontSize: 18 }} />, sub: 'No mortgage date on record' },
                ].map(({ label, value, color, icon, sub }) => (
                  <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box sx={{ color }}>{icon}</Box>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
                        <Typography variant="caption" color="text.secondary">{sub}</Typography>
                      </Box>
                    </Stack>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" sx={{ fontWeight: 700, color }}>{value.toLocaleString()}</Typography>
                      <Typography variant="caption" color="text.secondary">{pct(value, s.total)} of total</Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Producer Progress</Typography>
              <Stack spacing={1}>
                {[
                  { label: 'Right-Party Contact', value: s.rightPartyContact, icon: <ContactPhoneIcon sx={{ fontSize: 16 }} />, color: '#1976d2' },
                  { label: 'Authorized to Quote', value: s.authorizedToQuote, icon: <RecordVoiceOverIcon sx={{ fontSize: 16 }} />, color: '#388e3c' },
                  { label: 'Quoted (POS)',          value: s.quotedPos,         icon: <RequestQuoteIcon sx={{ fontSize: 16 }} />, color: '#f57c00' },
                  { label: 'Bound',                 value: s.bound,             icon: <GavelIcon sx={{ fontSize: 16 }} />, color: '#7b1fa2' },
                ].map(({ label, value, icon, color }) => (
                  <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color }}>
                      {icon}
                      <Typography variant="body2">{label}</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ fontWeight: 700, color }}>
                      {value.toLocaleString()}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Container>
  );
}
