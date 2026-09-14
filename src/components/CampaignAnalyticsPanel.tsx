'use client';

import React, { useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, CircularProgress, Alert, Chip, Divider,
  Table, TableHead, TableRow, TableCell, TableBody, ToggleButton, ToggleButtonGroup,
} from '@mui/material';

/**
 * Campaign analytics: headline counters, a daily series, and per-step results.
 *
 * Every rate shown here is a UNIQUE count over emails sent — one recipient opening a
 * message six times is one opener, not six. The raw total is shown beside it so the
 * difference is visible rather than hidden behind a single flattering percentage.
 *
 * A rate over zero sends renders as "—", never "0%": a campaign that has not sent has
 * an unknown open rate, and printing 0% asserts that nobody opened it.
 *
 * Open and click figures are only as good as the tracking that produced them, so when
 * a campaign has that tracking switched off the panel says so instead of presenting a
 * structural zero as a result.
 */

type Analytics = {
  totals: {
    sent: number; contacted: number; opens: number; uniqueOpens: number;
    clicks: number; uniqueClicks: number; replies: number; uniqueReplies: number;
    bounced: number; unsubscribed: number; completed: number; opportunities: number;
  };
  rates: { open: number | null; click: number | null; reply: number | null; bounce: number | null };
  daily: Array<{ date: string; sent: number; opened: number; replies: number; clicks: number }>;
  steps: Array<{
    step: number; variant: string; sent: number; opened: number; replies: number;
    clicks: number; openRate: number | null; replyRate: number | null;
  }>;
  caveats: string[];
};

const RANGES = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null as number | null },
];

const isoDaysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const rate = (v: number | null) => (v == null ? '—' : `${v}%`);

function Metric({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad';
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 132, flex: '1 1 132px' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: tone === 'good' ? '#166534' : tone === 'bad' ? '#b3261e' : undefined,
        }}
      >
        {value}
      </Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

/**
 * A small grouped bar chart, drawn directly as SVG.
 *
 * Deliberately not a charting dependency: this is one chart with four series and no
 * interaction beyond a tooltip, and a chart library is a large amount of bundle and
 * upgrade surface to carry for that.
 */
function DailyChart({ data }: { data: Analytics['daily'] }) {
  const W = 760;
  const H = 200;
  const PAD = { top: 12, right: 12, bottom: 28, left: 36 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = Math.max(1, ...data.map((d) => Math.max(d.sent, d.opened, d.replies, d.clicks)));
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(1.5, Math.min(10, (slot - 4) / 4));

  const series = [
    { key: 'sent' as const, colour: '#c7d2e0', label: 'Sent' },
    { key: 'opened' as const, colour: '#5b8def', label: 'Opened' },
    { key: 'clicks' as const, colour: '#f2a541', label: 'Clicked' },
    { key: 'replies' as const, colour: '#2e9e5b', label: 'Replied' },
  ];

  // Four gridlines is enough to read a bar against without turning into a ledger.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
        {series.map((s) => (
          <Stack key={s.key} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: s.colour }} />
            <Typography variant="caption" color="text.secondary">{s.label}</Typography>
          </Stack>
        ))}
      </Stack>

      <Box sx={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: 'block' }} role="img" aria-label="Daily campaign activity">
          {[...new Set(ticks)].map((t) => {
            const y = PAD.top + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#eceff3" strokeWidth={1} />
                <text x={PAD.left - 6} y={y + 3.5} textAnchor="end" fontSize={9} fill="#8a94a3">{t}</text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const x0 = PAD.left + i * slot;
            return (
              <g key={d.date}>
                <title>
                  {`${d.date} — sent ${d.sent}, opened ${d.opened}, clicked ${d.clicks}, replied ${d.replies}`}
                </title>
                {series.map((s, n) => {
                  const v = d[s.key];
                  const h = (v / max) * plotH;
                  return (
                    <rect
                      key={s.key}
                      x={x0 + 2 + n * (barW + 1)}
                      y={PAD.top + plotH - h}
                      width={barW}
                      height={h}
                      fill={s.colour}
                      rx={1}
                    />
                  );
                })}
              </g>
            );
          })}

          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#d6dbe3" />

          {/* Only the ends and middle get a label; one per bar is unreadable at 90 days. */}
          {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((i) => (
              <text
                key={i} x={PAD.left + i * slot + slot / 2} y={H - 8}
                textAnchor="middle" fontSize={9} fill="#8a94a3"
              >
                {data[i].date.slice(5)}
              </text>
            ))}
        </svg>
      </Box>
    </Box>
  );
}

export default function CampaignAnalyticsPanel({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('30');

  // State lands in the fetch callbacks rather than synchronously in the effect body;
  // `loading` is raised by whatever triggers a reload (mount default, or the range
  // toggle) so the effect itself only subscribes to the result.
  useEffect(() => {
    let cancelled = false;
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const qs = days ? `?start=${isoDaysAgo(days)}&end=${new Date().toISOString().slice(0, 10)}` : '';

    fetch(`/api/lead-campaigns/${campaignId}/analytics${qs}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not load the analytics');
        return json as Analytics;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the analytics');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [campaignId, range]);

  const changeRange = (next: string) => {
    if (next === range) return;
    setLoading(true);
    setRange(next);
  };

  if (loading && !data) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">Loading analytics…</Typography>
        </Stack>
      </Paper>
    );
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  const t = data.totals;
  const neverSent = t.sent === 0;

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="h6">Performance</Typography>
        <ToggleButtonGroup
          size="small" exclusive value={range}
          onChange={(_, v) => { if (v) changeRange(v); }}
        >
          {RANGES.map((r) => <ToggleButton key={r.key} value={r.key}>{r.label}</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>

      {neverSent && (
        <Alert severity="info">
          This campaign has not sent anything yet, so there is nothing to measure. Rates
          show as — rather than 0% until the first email goes out.
        </Alert>
      )}

      {data.caveats.includes('open-tracking-off') && (
        <Alert severity="warning">
          Open tracking is off for this campaign, so the open figures below will stay at
          zero however well it performs. Turn it on under Settings if you want them — but
          note every mailbox here falls back to the platform&apos;s shared tracking domain,
          which carries other senders&apos; reputation.
        </Alert>
      )}
      {data.caveats.includes('link-tracking-off') && (
        <Alert severity="warning">
          Link tracking is off, so clicks will read zero regardless of what recipients do.
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Metric label="Emails sent" value={t.sent.toLocaleString()} sub={`${t.contacted.toLocaleString()} leads contacted`} />
        <Metric label="Open rate" value={rate(data.rates.open)} sub={`${t.uniqueOpens.toLocaleString()} openers · ${t.opens.toLocaleString()} opens`} />
        <Metric label="Click rate" value={rate(data.rates.click)} sub={`${t.uniqueClicks.toLocaleString()} clickers`} />
        <Metric
          label="Reply rate" value={rate(data.rates.reply)}
          sub={`${t.uniqueReplies.toLocaleString()} replied`}
          tone={data.rates.reply != null && data.rates.reply > 0 ? 'good' : undefined}
        />
        <Metric
          label="Bounce rate" value={rate(data.rates.bounce)}
          sub={`${t.bounced.toLocaleString()} bounced`}
          tone={data.rates.bounce != null && data.rates.bounce >= 3 ? 'bad' : undefined}
        />
        <Metric label="Unsubscribed" value={t.unsubscribed.toLocaleString()} sub={`${t.completed.toLocaleString()} finished the sequence`} />
      </Stack>

      {data.rates.bounce != null && data.rates.bounce >= 3 && (
        <Alert severity="error">
          A bounce rate at or above 3% puts the sending domain&apos;s reputation at risk.
          Pause the campaign and clean the list before sending more.
        </Alert>
      )}

      <Divider />

      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>Daily activity</Typography>
        {data.daily.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No activity in this period.
            </Typography>
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <DailyChart data={data.daily} />
          </Paper>
        )}
      </Box>

      <Box>
        <Typography variant="h6" sx={{ mb: 1.5 }}>By email in the sequence</Typography>
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Email', 'Sent', 'Opened', 'Open rate', 'Clicked', 'Replied', 'Reply rate'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.steps.map((s) => (
                <TableRow key={`${s.step}-${s.variant}`} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    Email {s.step}
                    {s.variant !== '0' && <Chip size="small" label={`variant ${s.variant}`} sx={{ ml: 1, height: 18, fontSize: 10 }} />}
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.sent.toLocaleString()}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.opened.toLocaleString()}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{rate(s.openRate)}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.clicks.toLocaleString()}</TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: s.replies > 0 ? 700 : 400, color: s.replies > 0 ? '#166534' : undefined }}>
                    {s.replies.toLocaleString()}
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{rate(s.replyRate)}</TableCell>
                </TableRow>
              ))}
              {data.steps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: '#888' }}>
                    Nothing has been sent from this sequence yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      </Box>
    </Stack>
  );
}
