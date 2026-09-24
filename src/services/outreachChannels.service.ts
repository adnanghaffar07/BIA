import { sql } from '@/lib/neon';
import { computeMetrics } from './protectiveMetrics.service';
import { getQcReport } from './reports.service';

/**
 * The per-channel half of the outreach dashboard (directive Sec. 10.7).
 *
 * outreachDashboard.service.ts answers "is the Grade A list ready to send" — the pull-to-
 * bound ladder and the guardrails from Frank's KPI Tracker. This answers the rest of what
 * 10.7 asks for: the three channel funnels, the cross-channel decision view, response
 * time, and deliverability per mailbox.
 *
 * ── Nothing here re-derives what another service owns ───────────────────────
 * The phone funnel is an aggregate of the `call_outcome` report, not a second reading of
 * CallAttempt. Deliverability comes from computeMetrics. Band accuracy and loss analysis
 * are not here at all — quoteOutcomes.service already exposes bandAccuracy() and
 * lossAnalysis(), cut the way Sec. 10.9 and 10.6 ask, and the dashboard calls those.
 *
 * That rule is not tidiness. This dashboard shipped with its own bounce and complaint
 * rates carrying no thresholds while protectiveMetrics was enforcing real ones over the
 * same events, so one screen would have read "no target" while the other paused the
 * campaign. Every number below either comes from the service that owns it or is derived
 * here once and nowhere else.
 *
 * ── Honest zeroes, again ────────────────────────────────────────────────────
 * Nothing has been sent and one call has been logged, so most of this reads "not started".
 * That is the correct output, not a gap: 10.7 says "a partial dashboard on time beats a
 * complete one in November", and a funnel that shows structure with nothing in it is how
 * the first send becomes legible the day it happens.
 */

/** One rung. `of` names the rung its rate is measured against — never the top. */
export type ChannelRung = {
  key: string;
  label: string;
  count: number;
  of: string | null;
  rate: number | null;
  started: boolean;
  note?: string;
};

export type ChannelFunnel = {
  channel: 'email' | 'phone' | 'mail';
  label: string;
  /** False until the channel has done anything at all. */
  started: boolean;
  /** Said plainly when the channel has not started, instead of ten zeroes. */
  status: string;
  rungs: ChannelRung[];
  /** Channel-specific figures 10.7 names explicitly, e.g. attempts per contact. */
  extras: Array<{ label: string; value: number | null; suffix?: string; note?: string }>;
};

export type CrossChannelRow = {
  channel: string;
  contacts: number;
  quotes: number;
  binds: number;
  boundPremium: number | null;
  commission: number | null;
  costTotal: number | null;
  costPerContact: number | null;
  costPerQuote: number | null;
  costPerBind: number | null;
};

export type ResponseTime = {
  measured: number;
  medianMinutes: number | null;
  meanMinutes: number | null;
  slowestMinutes: number | null;
  /** Within the 15-minute SLA the HOT call-to-action promises. */
  withinSlaPct: number | null;
  note: string;
};

export type DeliverabilityRow = {
  mailbox: string;
  sent: number;
  bounces: number;
  complaints: number;
  unsubscribes: number;
  bounceRate: number | null;
  complaintRate: number | null;
  unsubRate: number | null;
};

export type Economics = {
  commissionRatePct: number | null;
  costPerEmailSent: number | null;
  costPerCallMinute: number | null;
  costPerSkipTrace: number | null;
  /** The settings that are absent, named so the screen can say what it cannot compute. */
  missing: string[];
};

export type OutreachChannels = {
  funnels: ChannelFunnel[];
  crossChannel: CrossChannelRow[];
  responseTime: ResponseTime;
  deliverability: DeliverabilityRow[];
  economics: Economics;
  /** The verdict metric, as 10.7 words it: premium and commission per 1,000 sent. */
  headline: {
    emailsSent: number;
    boundPremiumPer1k: number | null;
    commissionPer1k: number | null;
    note: string;
  };
};

/**
 * What counts as delivered.
 *
 * Sec 10.7 measures engagement ON DELIVERED, so this is the denominator the 27% target and
 * the 18% Pivot Plan floor are read against. The campaign platform has no concept of
 * delivery: none of the 25 fields its analytics return mentions it, and it emits no
 * delivery event. Waiting for deliveredAt to fill would mean waiting forever.
 *
 * So it is derived the way the industry derives it — sent, and did not bounce — while
 * still preferring a real deliveredAt if the platform ever starts sending one. A bounce is
 * the only evidence of non-delivery anyone gets, and the platform does report those.
 *
 * This is an inference, not an observation: a message silently dropped by a receiving
 * server counts as delivered here. The seed test is what catches that, which is why inbox
 * placement is a separate guardrail and not a substitute for this number.
 */
const DELIVERED_RULE = 'sent and not bounced (the platform reports no delivery events)';

const pct = (n: number, d: number): number | null =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : null;
const money = (n: number | null): number | null =>
  n == null ? null : Math.round(n * 100) / 100;
const num = (v: unknown): number => Number(v ?? 0);

/**
 * Which reply classifications mean intent, and which mean a quote was asked for.
 *
 * Taken from REPLY_CLASSES and CTAS rather than invented here. 'interested' is labelled
 * "wants a quote or review", so it IS a quote request; 'wrong_timing' is labelled
 * "Interested — wrong timing", so it is intent but not a request. The CTA dispositions say
 * the same thing in the other direction: `quote` is HOT, `savings` is WARM.
 *
 * Written as SQL-side lists because these counts run over the whole event table.
 */
const POSITIVE_INTENT_CLASSES = ['interested', 'wrong_timing'];
const POSITIVE_INTENT_CTAS = ['quote', 'savings'];
const QUOTE_REQUEST_CLASSES = ['interested'];
const QUOTE_REQUEST_CTAS = ['quote'];

/** Read the money settings. Absent means absent — never a default that looks like a fact. */
async function readEconomics(): Promise<Economics> {
  const rows = await sql`
    SELECT "key", "value" FROM "AppConfig"
     WHERE "key" IN ('commission_rate_pct','cost_per_email_sent','cost_per_call_minute','cost_per_skiptrace')` as Array<Record<string, unknown>>;
  const map = new Map(rows.map((r: Record<string, unknown>) => [String(r.key), String(r.value)]));
  const read = (k: string): number | null => {
    const v = map.get(k);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const e: Economics = {
    commissionRatePct: read('commission_rate_pct'),
    costPerEmailSent: read('cost_per_email_sent'),
    costPerCallMinute: read('cost_per_call_minute'),
    costPerSkipTrace: read('cost_per_skiptrace'),
    missing: [],
  };
  if (e.commissionRatePct == null) e.missing.push('commission_rate_pct');
  if (e.costPerEmailSent == null) e.missing.push('cost_per_email_sent');
  if (e.costPerCallMinute == null) e.missing.push('cost_per_call_minute');
  if (e.costPerSkipTrace == null) e.missing.push('cost_per_skiptrace');
  return e;
}

export async function getOutreachChannels(params: {
  effFrom?: string;
  effTo?: string;
  campaignId?: string;
} = {}): Promise<OutreachChannels> {
  const { effFrom, effTo, campaignId } = params;
  const from = effFrom ?? null;
  const to = effTo ?? null;
  const camp = campaignId ?? null;

  const economics = await readEconomics();

  // ── Email funnel (10.7's exact rungs) ────────────────────────────────────
  /**
   * Counted on DISTINCT recipients, not on events. One person sent four steps is one
   * person emailed; counting rows would report a four-message sequence as four people and
   * make every rate below it meaningless.
   */
  const [em] = await sql`
    SELECT
      COUNT(DISTINCT "recipientEmail") FILTER (WHERE "sentAt" IS NOT NULL)      AS sent,
      -- Delivered: observed where the platform tells us, derived where it does not.
      -- See DELIVERED_RULE at the top of this file.
      COUNT(DISTINCT "recipientEmail") FILTER (WHERE "deliveredAt" IS NOT NULL
                                                 OR ("sentAt" IS NOT NULL AND "bouncedAt" IS NULL)) AS delivered,
      COUNT(DISTINCT "recipientEmail") FILTER (WHERE "clickedAt" IS NOT NULL
                                                 OR "repliedAt" IS NOT NULL)    AS engaged,
      COUNT(DISTINCT "recipientEmail") FILTER (WHERE "replyClass" = ANY(${POSITIVE_INTENT_CLASSES})
                                                 OR "ctaAction"  = ANY(${POSITIVE_INTENT_CTAS})) AS intent,
      COUNT(DISTINCT "recipientEmail") FILTER (WHERE "replyClass" = ANY(${QUOTE_REQUEST_CLASSES})
                                                 OR "ctaAction"  = ANY(${QUOTE_REQUEST_CTAS}))   AS requested,
      COUNT(DISTINCT "leadId")         FILTER (WHERE "sentAt" IS NOT NULL)      AS leads_emailed,
      COUNT(*) FILTER (WHERE "sentAt" IS NOT NULL)::int                         AS sends
      FROM "OutreachEvent"
     WHERE (${from}::text IS NULL OR "cohort" >= ${from})
       AND (${to}::text   IS NULL OR "cohort" <= ${to})
       AND (${camp}::text IS NULL OR "vendorCampaignId" = ${camp})` as Array<Record<string, unknown>>;

  /**
   * Quoted, bound and lost come from the LEAD, not the event: an outcome belongs to the
   * lead whatever channel produced it. Restricted to leads the email actually reached, so
   * the rung is "of the people we emailed, how many quoted" rather than a house total
   * dropped underneath an email funnel.
   */
  const [emOut] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE l."quotedPremium" IS NOT NULL)::int AS quoted,
      COUNT(*) FILTER (WHERE l."boundPremium"  IS NOT NULL)::int AS bound,
      -- Lost is lostAt OR lostReason: the outcome panel stamps the date, the lead card's
      -- status dropdown only sets the reason, and the card itself tests both. Counting on
      -- the date alone put this funnel two losses behind the Lost analysis on the same
      -- screen — one number, two definitions, which is the fault this dashboard exists to
      -- stop reporting.
      COUNT(*) FILTER (WHERE (l."lostAt" IS NOT NULL OR l."lostReason" IS NOT NULL)
                         AND l."quotedPremium" IS NOT NULL)::int AS lost_after_quote,
      COUNT(*) FILTER (WHERE (l."lostAt" IS NOT NULL OR l."lostReason" IS NOT NULL)
                         AND l."quotedPremium" IS NULL)::int     AS lost_before_quote,
      COALESCE(SUM(l."boundPremium") FILTER (WHERE l."boundPremium" IS NOT NULL), 0) AS bound_premium
      FROM "Lead" l
     WHERE EXISTS (
       SELECT 1 FROM "OutreachEvent" e
        WHERE e."leadId" = l."id" AND e."sentAt" IS NOT NULL
          AND (${camp}::text IS NULL OR e."vendorCampaignId" = ${camp}))
       AND (${from}::text IS NULL OR l."cohort" >= ${from})
       AND (${to}::text   IS NULL OR l."cohort" <= ${to})` as Array<Record<string, unknown>>;

  const sent = num(em?.sent);
  const delivered = num(em?.delivered);
  const engaged = num(em?.engaged);
  const intent = num(em?.intent);
  const requested = num(em?.requested);
  const emailQuoted = num(emOut?.quoted);
  const emailBound = num(emOut?.bound);
  /**
   * A loss only belongs on the "quoted" rung if a quote ever existed.
   *
   * 10.7 writes the ladder as "quoted → bound / lost", which reads as though every loss
   * follows a quote. The data says otherwise: the one loss on the book today was recorded
   * with no quotedPremium at all. Counting it against `quoted` puts it in a denominator it
   * was never part of — and with quoted at zero it produced a funnel reading "Lost 1 of
   * Quoted 0", which is either a division by zero or a lie depending on how it is rendered.
   *
   * So the rung counts losses that had a quote, and losses before one are reported beside
   * it as their own number rather than folded in or dropped.
   */
  const emailLost = num(emOut?.lost_after_quote);
  const emailLostBeforeQuote = num(emOut?.lost_before_quote);
  const emailBoundPremium = num(emOut?.bound_premium);
  const sends = num(em?.sends);

  const emailFunnel: ChannelFunnel = {
    channel: 'email',
    label: 'Email',
    started: sent > 0,
    status: sent > 0 ? `${sent.toLocaleString()} people emailed` : 'No email has been sent yet.',
    rungs: [
      {
        key: 'sent', label: 'Sent', count: sent, of: null, rate: null, started: sent > 0,
        note: 'Stamped when the lead is pushed to the campaign platform, and confirmed by '
          + "the platform's own sent event. It means handed over, not opened.",
      },
      {
        key: 'delivered', label: 'Delivered', count: delivered, of: 'sent',
        rate: pct(delivered, sent), started: delivered > 0,
        /**
         * The rung everything below is measured against, and the one that was silently
         * unmeasurable: until 24 Sep 2026 the webhook classified a delivery event as a
         * send, so nothing ever wrote deliveredAt. It reads zero for every message sent
         * before that fix, because the event that would have filled it was discarded.
         */
        note: `Derived: ${DELIVERED_RULE}. A message silently dropped by a receiving `
          + 'server still counts here — inbox placement is the guardrail that catches that.',
      },
      {
        key: 'engaged', label: 'Engaged', count: engaged, of: 'delivered',
        rate: pct(engaged, delivered), started: engaged > 0,
        note: 'Measured on delivered, as Sec. 10.7 specifies — a click or any classified reply.',
      },
      {
        key: 'intent', label: 'Positive intent', count: intent, of: 'engaged',
        rate: pct(intent, engaged), started: intent > 0,
        note: 'Replies classed "interested" or "wrong timing", or a Quote / What-would-I-save click.',
      },
      {
        key: 'requested', label: 'Quote requested', count: requested, of: 'intent',
        rate: pct(requested, intent), started: requested > 0,
        note: 'The Quote call-to-action, or a reply classed "interested" — which the vocabulary defines as wanting a quote.',
      },
      {
        key: 'quoted', label: 'Quoted', count: emailQuoted, of: 'requested',
        rate: pct(emailQuoted, requested), started: emailQuoted > 0,
      },
      {
        key: 'bound', label: 'Bound', count: emailBound, of: 'quoted',
        rate: pct(emailBound, emailQuoted), started: emailBound > 0,
      },
      {
        key: 'lost', label: 'Lost', count: emailLost, of: 'quoted',
        rate: pct(emailLost, emailQuoted), started: emailLost > 0,
        note: 'A terminal alongside bound, not below it — the two share a denominator. '
          + 'Counts only losses that had a quote.',
      },
    ],
    extras: [
      {
        label: 'Messages sent per person', suffix: '',
        value: sent > 0 ? Math.round((sends / sent) * 10) / 10 : null,
        note: 'The sequence length actually delivered, not the one configured.',
      },
      {
        label: 'Lost before a quote', value: emailLostBeforeQuote,
        note: 'Recorded as lost without a quote ever being given, so it is not part of the '
          + 'quoted → bound / lost split above.',
      },
    ],
  };

  // ── Phone funnel ─────────────────────────────────────────────────────────
  /**
   * Built from the call_outcome report rather than from CallAttempt directly.
   *
   * That report already derives call status and quote stage, and its own suite asserts it
   * agrees with the lead card lead by lead. Reading CallAttempt again here would be a
   * third implementation of the stop rule — four attempts across three distinct days — and
   * the first time someone changed it, this dashboard would quietly keep the old one.
   */
  const callRows = await getQcReport('call_outcome', { effFrom, effTo });
  const assigned = callRows.length;
  const attempted = callRows.filter((r) => r.callStatus !== 'not_attempted').length;
  const contacted = callRows.filter((r) => r.callStatus === 'contacted').length;
  const unreachable = callRows.filter((r) => r.callStatus === 'unreachable').length;
  const phoneQuoted = callRows.filter((r) => r.quoteStage === 'quoted' || r.quoteStage === 'sold').length;
  const phoneBound = callRows.filter((r) => r.quoteStage === 'sold').length;
  // Same split as the email funnel, for the reason given there.
  const phoneLost = callRows.filter((r) => r.quoteStage === 'lost' && r.quotedPremium != null).length;
  const phoneLostBeforeQuote = callRows.filter((r) => r.quoteStage === 'lost' && r.quotedPremium == null).length;
  const totalAttempts = callRows.reduce((a, r) => a + (r.callAttempts ?? 0), 0);

  const phoneFunnel: ChannelFunnel = {
    channel: 'phone',
    label: 'Phone',
    started: attempted > 0,
    status: attempted > 0
      ? `${attempted.toLocaleString()} of ${assigned.toLocaleString()} assigned leads attempted`
      : `${assigned.toLocaleString()} leads assigned, none called yet.`,
    rungs: [
      {
        key: 'assigned', label: 'Assigned', count: assigned, of: null, rate: null,
        started: assigned > 0,
        note: 'Workable grades, plus anything already worked.',
      },
      {
        key: 'attempted', label: 'Attempted', count: attempted, of: 'assigned',
        rate: pct(attempted, assigned), started: attempted > 0,
      },
      {
        key: 'contacted', label: 'Contacted', count: contacted, of: 'attempted',
        rate: pct(contacted, attempted), started: contacted > 0,
        note: 'Reached a person — not merely dialled.',
      },
      {
        key: 'quoted', label: 'Quoted', count: phoneQuoted, of: 'contacted',
        rate: pct(phoneQuoted, contacted), started: phoneQuoted > 0,
      },
      {
        key: 'bound', label: 'Bound', count: phoneBound, of: 'quoted',
        rate: pct(phoneBound, phoneQuoted), started: phoneBound > 0,
      },
      {
        key: 'lost', label: 'Lost', count: phoneLost, of: 'quoted',
        rate: pct(phoneLost, phoneQuoted), started: phoneLost > 0,
      },
    ],
    extras: [
      {
        label: 'Attempts per contact',
        value: contacted > 0 ? Math.round((totalAttempts / contacted) * 10) / 10 : null,
        note: 'Dials it takes to reach one person. Null until someone has been reached.',
      },
      {
        label: 'Unreachable rate', suffix: '%',
        value: pct(unreachable, attempted),
        note: 'Four attempts across three distinct days with no contact (Sec. 10.5).',
      },
      {
        label: 'Lost before a quote', value: phoneLostBeforeQuote,
        note: 'Recorded as lost without a quote ever being given, so it is not part of the '
          + 'quoted → bound / lost split above.',
      },
    ],
  };

  // ── Mail funnel ──────────────────────────────────────────────────────────
  /** A placeholder, as 10.7 asks: the shape exists so the first drop has somewhere to land. */
  const mailFunnel: ChannelFunnel = {
    channel: 'mail',
    label: 'Direct mail',
    started: false,
    status: 'Not started. 10.7 holds this as a placeholder until direct mail begins.',
    rungs: [
      { key: 'sent', label: 'Pieces mailed', count: 0, of: null, rate: null, started: false },
      { key: 'responded', label: 'Responded', count: 0, of: 'sent', rate: null, started: false },
      { key: 'quoted', label: 'Quoted', count: 0, of: 'responded', rate: null, started: false },
      { key: 'bound', label: 'Bound', count: 0, of: 'quoted', rate: null, started: false },
    ],
    extras: [],
  };

  // ── Cross-channel decision view ──────────────────────────────────────────
  /**
   * 10.7: "This is how we decide where the next dollar goes."
   *
   * Cost is each channel's own direct spend and nothing else. Skip-trace credits are NOT
   * allocated across channels here: a trace that finds an email and a phone number serves
   * both, and splitting it needs a rule from Frank rather than one invented in a service.
   * It is reported as its own unallocated line so the total is still visible.
   */
  const [phoneMinutes] = await sql`
    SELECT COALESCE(SUM("durationSeconds"), 0) / 60.0 AS minutes FROM "CallAttempt"` as Array<Record<string, unknown>>;
  const [phonePremium] = await sql`
    SELECT COALESCE(SUM("boundPremium"), 0) AS p FROM "Lead"
     WHERE "boundPremium" IS NOT NULL
       AND EXISTS (SELECT 1 FROM "CallAttempt" c WHERE c."leadId" = "Lead"."id")` as Array<Record<string, unknown>>;

  const commissionOf = (premium: number | null): number | null =>
    premium == null || economics.commissionRatePct == null
      ? null
      : money(premium * (economics.commissionRatePct / 100));

  const emailCost = economics.costPerEmailSent == null ? null : money(sends * economics.costPerEmailSent);
  const phoneCost = economics.costPerCallMinute == null
    ? null
    : money(num(phoneMinutes?.minutes) * economics.costPerCallMinute);

  const per = (cost: number | null, n: number): number | null =>
    cost == null || n <= 0 ? null : money(cost / n);

  const crossChannel: CrossChannelRow[] = [
    {
      channel: 'Email',
      contacts: engaged,
      quotes: emailQuoted,
      binds: emailBound,
      boundPremium: money(emailBoundPremium),
      commission: commissionOf(emailBoundPremium),
      costTotal: emailCost,
      costPerContact: per(emailCost, engaged),
      costPerQuote: per(emailCost, emailQuoted),
      costPerBind: per(emailCost, emailBound),
    },
    {
      channel: 'Phone',
      contacts: contacted,
      quotes: phoneQuoted,
      binds: phoneBound,
      boundPremium: money(num(phonePremium?.p)),
      commission: commissionOf(num(phonePremium?.p)),
      costTotal: phoneCost,
      costPerContact: per(phoneCost, contacted),
      costPerQuote: per(phoneCost, phoneQuoted),
      costPerBind: per(phoneCost, phoneBound),
    },
    {
      channel: 'Direct mail',
      contacts: 0, quotes: 0, binds: 0,
      boundPremium: null, commission: null, costTotal: null,
      costPerContact: null, costPerQuote: null, costPerBind: null,
    },
  ];

  // ── Response time ────────────────────────────────────────────────────────
  /**
   * 10.7: "engagement → first contact attempt, per lead and averaged."
   *
   * The clock starts at the engagement event and stops at the first call attempt AFTER it.
   * A call placed before the reply is not a response to it — taking the lead's first
   * attempt regardless of order would report a negative gap as a fast one.
   *
   * Median as well as mean, because one lead answered three days late drags a mean that a
   * median would leave alone, and 10.7 is asking how fast the team actually is.
   */
  const rt = await sql`
    WITH engagement AS (
      SELECT e."leadId", MIN(COALESCE(e."repliedAt", e."clickedAt")) AS engaged_at
        FROM "OutreachEvent" e
       WHERE (e."repliedAt" IS NOT NULL OR e."clickedAt" IS NOT NULL)
         AND (${from}::text IS NULL OR e."cohort" >= ${from})
         AND (${to}::text   IS NULL OR e."cohort" <= ${to})
       GROUP BY e."leadId"
    )
    SELECT EXTRACT(EPOCH FROM (
             (SELECT MIN(c."attemptedAt") FROM "CallAttempt" c
               WHERE c."leadId" = g."leadId" AND c."attemptedAt" >= g.engaged_at)
             - g.engaged_at)) / 60.0 AS minutes
      FROM engagement g` as Array<Record<string, unknown>>;

  const mins = rt.map((r) => (r.minutes == null ? null : Number(r.minutes)))
    .filter((m): m is number => m != null && Number.isFinite(m))
    .sort((a, b) => a - b);
  const median = mins.length
    ? (mins.length % 2 ? mins[(mins.length - 1) / 2]
      : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2)
    : null;

  const responseTime: ResponseTime = {
    measured: mins.length,
    medianMinutes: median == null ? null : Math.round(median),
    meanMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    slowestMinutes: mins.length ? Math.round(mins[mins.length - 1]) : null,
    // 15 minutes is the HOT call-to-action's own SLA, not a number chosen here.
    withinSlaPct: mins.length ? pct(mins.filter((m) => m <= 15).length, mins.length) : null,
    note: mins.length
      ? `${mins.length} engaged lead(s) with a follow-up call. The 15-minute target is the Quote call-to-action's own SLA.`
      : 'Nothing to measure yet — this needs an engagement followed by a call.',
  };

  // ── Deliverability, per mailbox ──────────────────────────────────────────
  /**
   * 10.7 asks for this per mailbox and per domain; computeMetrics already returns the
   * per-mailbox split, with the reason attached: "an aggregate hides which mailbox is
   * burning". Per-domain is not available until sends carry a domain — the event table
   * records the sending mailbox, and the domain is not separately stored.
   */
  const metrics = await computeMetrics({ windowDays: 7, campaignId });
  const deliverability: DeliverabilityRow[] = metrics.byMailbox.map((m) => ({
    mailbox: m.mailbox,
    sent: m.sent,
    bounces: m.bounces,
    complaints: m.complaints,
    unsubscribes: m.unsubscribes,
    bounceRate: pct(m.bounces, m.sent),
    complaintRate: pct(m.complaints, m.sent),
    unsubRate: pct(m.unsubscribes, m.sent),
  }));

  // ── The headline ─────────────────────────────────────────────────────────
  /**
   * 10.7's words: "bound premium and commission per 1,000 emails sent."
   *
   * Premium, not a count of binds — which is what this screen reported before the section
   * text was read. Commission needs a rate nobody has set, so it is null and says so
   * rather than quietly showing premium under a commission heading.
   */
  const totalPremium = emailBoundPremium;
  const headline = {
    emailsSent: sends,
    boundPremiumPer1k: sends > 0 ? money((totalPremium / sends) * 1000) : null,
    commissionPer1k: sends > 0 && economics.commissionRatePct != null
      ? money(((totalPremium * (economics.commissionRatePct / 100)) / sends) * 1000)
      : null,
    note: sends === 0
      ? 'No email has been sent, so the verdict metric has no denominator yet.'
      : economics.commissionRatePct == null
        ? 'Commission needs a rate — set commission_rate_pct in AppConfig.'
        : 'Bound premium and commission per 1,000 emails sent.',
  };

  return {
    funnels: [emailFunnel, phoneFunnel, mailFunnel],
    crossChannel,
    responseTime,
    deliverability,
    economics,
    headline,
  };
}
