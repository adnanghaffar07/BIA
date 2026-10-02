'use client';

import React, { useEffect, useMemo, useState } from 'react';
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

function Metric({ label, value, sub, tone, muted }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad';
  /** The figure cannot be trusted — greys it out and marks the reason underneath. */
  muted?: boolean;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 132, flex: '1 1 132px' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: muted ? '#b0b6c0'
            : tone === 'good' ? '#166534' : tone === 'bad' ? '#b3261e' : undefined,
        }}
      >
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: muted ? '#8a5a00' : 'text.secondary' }}>
          {sub}
        </Typography>
      )}
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

export default function CampaignAnalyticsPanel({ campaignId, contacts, reloadKey = 0 }: {
  campaignId: string;
  /**
   * The campaign's contact records, which the page already holds for its own chips.
   * Passed in so the reply figure can be checked against them — see the reconciliation
   * below. Omitting it simply leaves the vendor's own numbers untouched.
   */
  contacts?: Array<{ lastReply: string | null; lastContact: string | null }>;
  /**
   * Bumped by the page's Refresh button so this panel reloads along with everything else.
   *
   * Without it the panel only ever fetched on mount and on a range change, so Refresh
   * updated the lead chips above while the cards below kept the numbers they were born
   * with. A reply that arrived after the page opened showed as "1 replied" in the chip
   * and "Reply rate 0%" in the card, and no amount of refreshing moved it.
   */
  reloadKey?: number;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('30');

  // The window is derived here rather than inside the effect because the reconciliation
  // below has to measure contact timestamps against exactly the same bounds the figures
  // were fetched with. Identity only changes when the range does.
  const period = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    return days ? { start: isoDaysAgo(days), end: new Date().toISOString().slice(0, 10) } : null;
  }, [range]);

  // State lands in the fetch callbacks rather than synchronously in the effect body;
  // `loading` is raised by whatever triggers a reload (mount default, or the range
  // toggle) so the effect itself only subscribes to the result.
  useEffect(() => {
    let cancelled = false;
    const qs = period ? `?start=${period.start}&end=${period.end}` : '';

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
  }, [campaignId, period, reloadKey]);

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

  /**
   * The reply figure, reconciled against the contact records.
   *
   * The vendor keeps two sets of books. A contact's own record is written the instant a
   * reply lands; the /campaigns/analytics/overview counters are batched and trail it by
   * minutes. On 2 Oct a reply arrived at 18:57:23 and the aggregate still read zero
   * afterwards, so the card said "Reply rate 0% · 0 replied" directly underneath a chip
   * saying "1 replied" — the same event, two answers.
   *
   * Where the contacts show more replies than the aggregate has caught up with, the
   * contacts win: they are the record of what actually happened. Timestamps are measured
   * against the selected window so a reply from two months ago cannot be credited to the
   * 7-day view, and the denominator falls back to contacts reached when the aggregate has
   * not counted the send either — a reply over zero sends would otherwise read as a rate
   * above 100%.
   *
   * When the aggregate is level with the contacts, nothing here changes its numbers.
   */
  const inPeriod = (ts: string | null | undefined) => (
    !!ts && (!period || (ts.slice(0, 10) >= period.start && ts.slice(0, 10) <= period.end))
  );
  const liveReplies = contacts ? contacts.filter((c) => inPeriod(c.lastReply)).length : 0;
  const liveContacted = contacts ? contacts.filter((c) => inPeriod(c.lastContact)).length : 0;
  const replyLag = liveReplies > t.uniqueReplies;
  const replies = replyLag ? liveReplies : t.uniqueReplies;
  const replyDenom = replyLag ? Math.max(t.sent, liveContacted, replies) : t.sent;
  const replyRate = replyLag
    ? (replyDenom > 0 ? Math.round((replies / replyDenom) * 1000) / 10 : null)
    : data.rates.reply;

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

      {/* A caveat belongs on the number it affects, not in a banner above it. A zero
          open rate with tracking off is not a result, and the card says so in three
          words; three stacked banners saying the same thing just get scrolled past. */}
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Metric label="Emails sent" value={t.sent.toLocaleString()} sub={`${t.contacted.toLocaleString()} leads contacted`} />
        <Metric
          label="Open rate" value={rate(data.rates.open)}
          sub={data.caveats.includes('open-tracking-off')
            ? 'open tracking off'
            : `${t.uniqueOpens.toLocaleString()} openers · ${t.opens.toLocaleString()} opens`}
          muted={data.caveats.includes('open-tracking-off')}
        />
        <Metric
          label="Click rate" value={rate(data.rates.click)}
          sub={data.caveats.includes('link-tracking-off')
            ? 'link tracking off'
            : `${t.uniqueClicks.toLocaleString()} clickers`}
          muted={data.caveats.includes('link-tracking-off')}
        />
        <Metric
          label="Reply rate" value={rate(replyRate)}
          sub={`${replies.toLocaleString()} replied${replyLag ? ' · platform still counting' : ''}`}
          tone={replyRate != null && replyRate > 0 ? 'good' : undefined}
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
