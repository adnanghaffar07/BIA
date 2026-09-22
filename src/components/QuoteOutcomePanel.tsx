'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Stack, Chip, Button, TextField, Alert, Divider, Tooltip,
  MenuItem, Select, FormControl, InputLabel,
} from '@mui/material';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import { LOSS_REASONS, type LossReason } from '@/lib/lossReasons';

/**
 * What happened after the call (directive Sec. 10.9 and Sec. 10.6).
 *
 * Four moments, in the order they occur: the band Ruben rates in a carrier portal, the
 * quote he actually gives, and then the sale or the loss.
 *
 * ── Why the sale is typed in here ───────────────────────────────────────────
 * Frank, 22 Sep 2026: no HawkSoft integration for now, sales tracked by hand in the card
 * alongside the other interim KPIs. Recording it also STOPS outreach to the household —
 * see recordBind. That is deliberately not something this panel has to remember to do,
 * because "the UI calls suppress() too" is a hope that survives until the second caller.
 *
 * ── Why the band comparison is shown, not filed ─────────────────────────────
 * The instant a quote is recorded this says whether it landed inside the band the
 * homeowner READ, and by how much it missed the midpoint. That is the thesis being tested:
 * "if the band is wrong, E2 sets an expectation the quote cannot meet and we lose the
 * prospect after they raised their hand". A producer who sees the miss on the screen while
 * the customer is still on the phone can say something about it. A number that only
 * surfaces in a monthly report cannot be acted on at all.
 *
 * ── Why the competitor is asked for on every loss ───────────────────────────
 * Sec. 10.6: "Ask on every lost conversation." Not only on price losses — a lead lost on
 * coverage still says who else writes that municipality and at what premium, which is the
 * rating input the section is actually after.
 */

type State = {
  band: { low: number; high: number; mid: number; carrier: string | null; ratedAt: string | null; ratedBy: string | null } | null;
  published: { low: number; high: number } | null;
  quote: { premium: number; carrier: string | null; at: string | null } | null;
  bandHitAtQuote: boolean | null;
  varianceVsMidpointPct: number | null;
  bound: {
    premium: number; hit: boolean | null; variancePct: number | null;
    carrier: string | null; policyNumber: string | null; effectiveDate: string | null;
    at: string | null; by: string | null; notes: string | null;
  } | null;
  loss: {
    at: string | null; reason: string | null; notes: string | null;
    competingCarrier: string | null; competingPremium: number | null;
    premiumGap: number | null; premiumGapPct: number | null;
  } | null;
  reEngageAt: string | null;
};

const money = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function QuoteOutcomePanel({ leadId }: { leadId: string }) {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * A partial success, which is neither of the other two.
   *
   * A sale whose suppression failed IS saved — showing it as an error would have someone
   * type it again — but it leaves a bound customer still in a live campaign, which cannot
   * appear under a green tick either.
   */
  const [warn, setWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'band' | 'quote' | 'bind' | 'loss' | null>(null);

  const [bandLow, setBandLow] = useState('');
  const [bandHigh, setBandHigh] = useState('');
  const [bandCarrier, setBandCarrier] = useState('');
  const [qPremium, setQPremium] = useState('');
  const [qCarrier, setQCarrier] = useState('');
  const [bPremium, setBPremium] = useState('');
  const [bCarrier, setBCarrier] = useState('');
  const [bPolicy, setBPolicy] = useState('');
  const [bEffective, setBEffective] = useState('');
  const [bNotes, setBNotes] = useState('');
  const [lReason, setLReason] = useState<LossReason | ''>('');
  const [lCarrier, setLCarrier] = useState('');
  const [lPremium, setLPremium] = useState('');
  const [lNotes, setLNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/leads/${leadId}/outcome`)).json();
      if (!j.success) throw new Error(j.error || 'Could not read the outcome');
      setS(j.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the outcome'); }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) => {
    setBusy(true); setError(null); setMsg(null); setWarn(null);
    try {
      const j = await (await fetch(`/api/leads/${leadId}/outcome`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).json();
      if (!j.success) throw new Error(j.error || 'Failed');
      if (j.warning) setWarn(String(j.warning)); else setMsg(ok(j));
      setOpen(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  if (!s) return <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Loading…</Typography></Paper>;

  const lossSpec = LOSS_REASONS.find((r) => r.key === lReason);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <RequestQuoteIcon fontSize="small" sx={{ color: '#5a6675' }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Quote &amp; outcome</Typography>
        {s.loss && <Chip size="small" label="Lost" sx={{ height: 20, bgcolor: '#fdecea', color: '#b3261e', fontWeight: 700 }} />}
        {s.bound && <Chip size="small" label="Bound" sx={{ height: 20, bgcolor: '#e7f5ec', color: '#166534', fontWeight: 700 }} />}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg}</Alert>}
      {warn && <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setWarn(null)}>{warn}</Alert>}

      {/* ── What we know ────────────────────────────────────────────────── */}
      <Stack spacing={0.5} sx={{ mb: 1.5 }}>
        <Row label="Band">
          {s.band ? (
            <>
              <b>{money(s.band.low)} – {money(s.band.high)}</b>
              {s.band.carrier && <> · {s.band.carrier}</>}
              {s.band.ratedBy && <span style={{ color: '#9098a6' }}> · rated by {s.band.ratedBy}</span>}
            </>
          ) : <span style={{ color: '#9098a6' }}>not rated yet</span>}
        </Row>

        {/*
          Only shown when they differ. The band on the card can be re-rated after email 2
          went out, and the one that set the customer's expectation is the one they read —
          so when the two disagree, both have to be visible or the accuracy figure below
          looks arbitrary.
        */}
        {s.published && (
          <Row label="They were sent">
            <b>{money(s.published.low)} – {money(s.published.high)}</b>
            <span style={{ color: '#8a5a00' }}> · differs from the current band</span>
          </Row>
        )}

        <Row label="Quote">
          {s.quote ? (
            <>
              <b>{money(s.quote.premium)}</b>{s.quote.carrier && <> · {s.quote.carrier}</>}
              {s.bandHitAtQuote != null && (
                <Tooltip arrow title={
                  s.bandHitAtQuote
                    ? 'The quote landed inside the band the homeowner was sent.'
                    : 'The quote landed OUTSIDE the band the homeowner was sent. This is the case that loses a prospect after they raised their hand.'
                }>
                  <Chip
                    size="small"
                    label={s.bandHitAtQuote ? 'inside the band' : 'outside the band'}
                    sx={{
                      ml: 1, height: 18, cursor: 'help', fontWeight: 700,
                      bgcolor: s.bandHitAtQuote ? '#e7f5ec' : '#fdecea',
                      color: s.bandHitAtQuote ? '#166534' : '#b3261e',
                    }}
                  />
                </Tooltip>
              )}
              {s.varianceVsMidpointPct != null && (
                <span style={{ color: '#5a6675' }}>
                  {' '}· {s.varianceVsMidpointPct > 0 ? '+' : ''}{s.varianceVsMidpointPct}% vs midpoint
                </span>
              )}
            </>
          ) : <span style={{ color: '#9098a6' }}>not quoted yet</span>}
        </Row>

        {s.loss && (
          <>
            <Row label="Lost">
              <b>{LOSS_REASONS.find((r) => r.key === s.loss!.reason)?.label ?? s.loss.reason}</b>
              {s.loss.at && <span style={{ color: '#9098a6' }}> · {new Date(s.loss.at).toLocaleDateString()}</span>}
            </Row>
            <Row label="Beaten by">
              {s.loss.competingCarrier
                ? <>
                    <b>{s.loss.competingCarrier}</b> at {money(s.loss.competingPremium)}
                    {s.loss.premiumGap != null && (
                      <span style={{ color: s.loss.premiumGap > 0 ? '#b3261e' : '#166534' }}>
                        {' '}· we were {s.loss.premiumGap > 0 ? 'higher' : 'lower'} by {money(Math.abs(s.loss.premiumGap))}
                        {s.loss.premiumGapPct != null && ` (${Math.abs(s.loss.premiumGapPct)}%)`}
                      </span>
                    )}
                  </>
                : <span style={{ color: '#8a5a00' }}>not recorded — ask on every lost conversation</span>}
            </Row>
          </>
        )}

        {s.bound && (
          <>
            <Row label="Sold">
              <b>{money(s.bound.premium)}</b>
              {s.bound.carrier && <> · {s.bound.carrier}</>}
              {s.bound.hit != null && (
                <Tooltip arrow title={
                  s.bound.hit
                    ? 'The written premium landed inside the band the homeowner was sent.'
                    : 'The written premium landed OUTSIDE the band the homeowner was sent — they bought anyway, but the band was wrong.'
                }>
                  <Chip
                    size="small"
                    label={s.bound.hit ? 'inside the band' : 'outside the band'}
                    sx={{
                      ml: 1, height: 18, cursor: 'help', fontWeight: 700,
                      bgcolor: s.bound.hit ? '#e7f5ec' : '#fdecea',
                      color: s.bound.hit ? '#166534' : '#b3261e',
                    }}
                  />
                </Tooltip>
              )}
              {s.bound.variancePct != null && (
                <span style={{ color: '#5a6675' }}>
                  {' '}· {s.bound.variancePct > 0 ? '+' : ''}{s.bound.variancePct}% vs midpoint
                </span>
              )}
            </Row>
            <Row label="Policy">
              {s.bound.policyNumber
                ? <b>{s.bound.policyNumber}</b>
                // Not an error — a policy number is often issued after the bind. Amber so
                // it reads as unfinished rather than broken, because it is the field the
                // agency's book will eventually be reconciled against.
                : <span style={{ color: '#8a5a00' }}>not recorded yet</span>}
              {s.bound.effectiveDate && <span style={{ color: '#9098a6' }}> · effective {s.bound.effectiveDate}</span>}
              {s.bound.by && <span style={{ color: '#9098a6' }}> · entered by {s.bound.by}</span>}
            </Row>
          </>
        )}

        {s.reEngageAt && (
          <Row label="Revisit">
            <b>{s.reEngageAt}</b>
            <span style={{ color: '#9098a6' }}> · 60 days before the next renewal</span>
          </Row>
        )}
      </Stack>

      <Divider sx={{ mb: 1.5 }} />

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Button size="small" variant={open === 'band' ? 'contained' : 'outlined'}
          onClick={() => setOpen(open === 'band' ? null : 'band')}>
          {s.band ? 'Re-rate band' : 'Record band price'}
        </Button>
        <Button size="small" variant={open === 'quote' ? 'contained' : 'outlined'}
          onClick={() => setOpen(open === 'quote' ? null : 'quote')}>
          {s.quote ? 'Update quote' : 'Record quote'}
        </Button>
        {/*
          Sold sits before Lost and is the only filled button on the row. Both are
          terminal, and the one we want a producer to reach for should not be the one
          styled like an afterthought.
        */}
        <Button size="small" variant={open === 'bind' ? 'contained' : 'outlined'} color="success"
          onClick={() => setOpen(open === 'bind' ? null : 'bind')}>
          {s.bound ? 'Update sale' : 'Mark as sold'}
        </Button>
        <Button size="small" variant={open === 'loss' ? 'contained' : 'outlined'} color="error"
          onClick={() => setOpen(open === 'loss' ? null : 'loss')}>
          {s.loss ? 'Update loss' : 'Record loss'}
        </Button>
      </Stack>

      {open === 'bind' && (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField size="small" label="Written premium" type="number" value={bPremium}
              onChange={(e) => setBPremium(e.target.value)} />
            <TextField size="small" label="Carrier" fullWidth value={bCarrier}
              onChange={(e) => setBCarrier(e.target.value)} placeholder="Travelers / Plymouth Rock" />
            <TextField size="small" label="Policy number" fullWidth value={bPolicy}
              onChange={(e) => setBPolicy(e.target.value)} placeholder="optional — can be added later" />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            {/*
              When cover STARTS, not when this was typed in. They are usually days apart
              and answer different questions — the second measures our cycle, the first is
              what next year's renewal week is counted from.
            */}
            <TextField size="small" label="Effective date" type="date" value={bEffective}
              onChange={(e) => setBEffective(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField size="small" label="Notes" fullWidth value={bNotes}
              onChange={(e) => setBNotes(e.target.value)} />
            <Button
              size="small" variant="contained" color="success"
              disabled={busy || !bPremium || !bCarrier.trim()}
              onClick={() => post(
                {
                  action: 'bind',
                  premium: Number(bPremium),
                  carrier: bCarrier,
                  policyNumber: bPolicy || null,
                  effectiveDate: bEffective || null,
                  notes: bNotes || null,
                },
                // Only the clean case. A failed suppression comes back as `warning` and
                // post() routes it to the amber alert instead of this one.
                () => `Sold — ${bCarrier.trim()}. Outreach to this household has stopped.`,
              )}
            >
              Save
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Recording a sale stops all cold outreach to this household, including the
            co-insured&apos;s addresses. A policy covers the property, not one mailbox.
          </Typography>
        </Box>
      )}

      {open === 'band' && (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField size="small" label="Low" type="number" value={bandLow} onChange={(e) => setBandLow(e.target.value)} />
            <TextField size="small" label="High" type="number" value={bandHigh} onChange={(e) => setBandHigh(e.target.value)} />
            <TextField size="small" label="Carrier portal" fullWidth value={bandCarrier}
              onChange={(e) => setBandCarrier(e.target.value)} placeholder="Travelers / Plymouth Rock" />
            <Button size="small" variant="contained" disabled={busy}
              onClick={() => post(
                { action: 'band', low: Number(bandLow), high: Number(bandHigh), carrier: bandCarrier },
                () => `Band recorded: ${money(Number(bandLow))}–${money(Number(bandHigh))}.`,
              )}>Save</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            Which carrier&apos;s portal produced this. Accuracy is reported by carrier, so a band with no
            carrier on it cannot be explained later.
          </Typography>
        </Box>
      )}

      {open === 'quote' && (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField size="small" label="Premium" type="number" value={qPremium} onChange={(e) => setQPremium(e.target.value)} />
            <TextField size="small" label="Carrier" fullWidth value={qCarrier} onChange={(e) => setQCarrier(e.target.value)} />
            <Button size="small" variant="contained" disabled={busy}
              onClick={() => post(
                { action: 'quote', premium: Number(qPremium), carrier: qCarrier },
                (j) => `Quote recorded.${j.bandHitAtQuote === false ? ' It is OUTSIDE the band they were sent.' : j.bandHitAtQuote ? ' Inside the band.' : ''}`,
              )}>Save</Button>
          </Stack>
        </Box>
      )}

      {open === 'loss' && (
        <Box sx={{ mt: 1.5 }}>
          <FormControl size="small" fullWidth sx={{ mb: 1 }}>
            <InputLabel>Why did we lose it?</InputLabel>
            <Select label="Why did we lose it?" value={lReason}
              onChange={(e) => setLReason(e.target.value as LossReason)}>
              {LOSS_REASONS.map((r) => <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>)}
            </Select>
          </FormControl>
          {lossSpec && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {lossSpec.meaning}
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
            <TextField size="small" label="Who beat us" fullWidth value={lCarrier}
              onChange={(e) => setLCarrier(e.target.value)} />
            <TextField size="small" label="Their premium" type="number" value={lPremium}
              onChange={(e) => setLPremium(e.target.value)} />
          </Stack>
          <TextField size="small" fullWidth label="Notes" value={lNotes}
            onChange={(e) => setLNotes(e.target.value)} sx={{ mb: 1 }} />
          {/*
            Asked even when the reason is not price. A loss on coverage still tells us who
            writes this municipality and at what premium — Sec. 10.6's "rating and appetite
            input, not just a sales note".
          */}
          {lossSpec && !lCarrier && (
            <Alert severity="info" sx={{ mb: 1 }}>
              {lossSpec.expectCompetitor
                ? 'Ask who they went with and what they paid — it is what makes this lead winnable next year.'
                : 'Usually no competitor on this one. Leave it blank rather than guessing — a guessed premium lands in the averages.'}
            </Alert>
          )}
          <Button size="small" variant="contained" color="error" disabled={busy || !lReason}
            onClick={() => post(
              {
                action: 'loss', reason: lReason,
                competingCarrier: lCarrier || null,
                competingPremium: lPremium ? Number(lPremium) : null,
                notes: lNotes || null,
              },
              (j) => `Loss recorded.${j.reEngageAt ? ` Coming back ${j.reEngageAt}.` : ''}`,
            )}>Record loss</Button>
        </Box>
      )}
    </Paper>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <Typography variant="caption" sx={{ minWidth: 92, color: '#5a6675', fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </Box>
  );
}
