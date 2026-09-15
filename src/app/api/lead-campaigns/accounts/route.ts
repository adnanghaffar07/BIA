import { NextRequest, NextResponse } from 'next/server';
import { listEmailAccounts } from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * GET /api/lead-campaigns/accounts — sending mailboxes, grouped by domain.
 *
 * Grouped rather than listed flat because the decisions this view supports are
 * per-domain: a tracking domain is configured per domain, and deliverability is
 * judged per domain. A mailbox with no tracking domain falls back to the vendor's
 * shared one, which is a spam signal on a cold send, so that gap is surfaced here
 * rather than left to be noticed in the vendor's dashboard.
 */
export async function GET(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const accounts = await listEmailAccounts();

    const domains = new Map<string, {
      domain: string;
      mailboxes: number;
      warmingUp: number;
      dailyCapacity: number;
      trackingDomain: string | null;
      trackingActive: boolean;
      warmupScores: number[];
    }>();

    for (const a of accounts) {
      const domain = String(a.email ?? '').split('@')[1] ?? '(unknown)';
      const row = domains.get(domain) ?? {
        domain, mailboxes: 0, warmingUp: 0, dailyCapacity: 0,
        trackingDomain: a.tracking_domain_name ?? null,
        trackingActive: String(a.tracking_domain_status ?? '').toUpperCase().includes('ACTIVE'),
        warmupScores: [],
      };
      row.mailboxes += 1;
      if (a.warmup_status === 1) row.warmingUp += 1;
      row.dailyCapacity += a.daily_limit ?? 0;
      if (typeof a.stat_warmup_score === 'number') row.warmupScores.push(a.stat_warmup_score);
      domains.set(domain, row);
    }

    const data = [...domains.values()].map((d) => ({
      domain: d.domain,
      mailboxes: d.mailboxes,
      warmingUp: d.warmingUp,
      dailyCapacity: d.dailyCapacity,
      trackingDomain: d.trackingDomain,
      trackingActive: d.trackingActive,
      avgWarmupScore: d.warmupScores.length
        ? Math.round(d.warmupScores.reduce((s, n) => s + n, 0) / d.warmupScores.length)
        : null,
    })).sort((a, b) => b.mailboxes - a.mailboxes);

    // Flat per-mailbox list, for the picker that chooses which mailboxes send a
    // campaign. "Active" means the platform will actually send from it: status 1 and
    // no pending setup. Verified across all 28 live accounts — a mailbox still being
    // set up reports setup_pending true and must not be offered as a sender.
    const mailboxes = accounts
      .map((a) => ({
        email: a.email,
        domain: String(a.email ?? '').split('@')[1] ?? '',
        name: [a.first_name, a.last_name].filter(Boolean).join(' ') || null,
        active: a.status === 1 && a.setup_pending !== true,
        warmingUp: a.warmup_status === 1,
        warmupScore: typeof a.stat_warmup_score === 'number' ? a.stat_warmup_score : null,
        dailyLimit: a.daily_limit ?? 0,
        trackingDomain: a.tracking_domain_name ?? null,
        // Raw codes, so the UI can tell "paused by us" from "the platform has an error
        // with it" — both look like "not sending" but only one is ours to fix here.
        status: a.status ?? null,
        setupPending: a.setup_pending === true,
        statusLabel: a.setup_pending === true ? 'Setting up'
          : a.status === 1 ? 'Active'
            : a.status === 2 ? 'Paused'
              : a.status === -1 ? 'Error'
                : 'Inactive',
      }))
      .sort((x, y) => (x.domain === y.domain ? x.email.localeCompare(y.email) : x.domain.localeCompare(y.domain)));

    return NextResponse.json({
      success: true,
      mailboxes,
      totalMailboxes: accounts.length,
      totalDailyCapacity: data.reduce((s, d) => s + d.dailyCapacity, 0),
      missingTrackingDomain: data.filter((d) => !d.trackingDomain).reduce((s, d) => s + d.mailboxes, 0),
      data,
    });
  } catch (err) {
    return vendorError(err, 'Could not load sending mailboxes');
  }
}
