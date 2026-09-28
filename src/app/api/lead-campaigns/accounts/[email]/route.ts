import { NextRequest, NextResponse } from 'next/server';
import {
  getEmailAccount, updateEmailAccount, getWarmupAnalytics, campaignsUsingMailbox,
  CAMPAIGN_STATUS, type WarmupAnalytics,
} from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * One sending mailbox, for the account drawer.
 *
 *   GET   → settings, warmup activity, and the campaigns sending from it
 *   PATCH → save the editable settings
 *
 * Three vendor calls in parallel on GET because the drawer shows all three tabs and
 * they are independent; doing them in sequence would triple the time to first paint
 * for no benefit.
 *
 * ── Field names were established empirically ──────────────────────────────────
 * PATCH /accounts/{email} IGNORES keys it does not recognise and returns 200, so a
 * misspelled field is indistinguishable from a successful save. Every key written here
 * was confirmed by sending it and reading it back. Two traps found that way:
 *   • "Mark important" is warmup.advanced.important_rate — mark_important is swallowed.
 *   • tags and the warmup filter tag are NOT exposed at all; they exist in the vendor's
 *     own UI but no API key reaches them, so this route cannot offer them.
 *
 * `signature` was on that second list and was wrong. It IS exposed, on the account object,
 * and PATCH writes it — proved by reading one, appending to it, reading the change back and
 * restoring the original byte-for-byte on a live mailbox. The earlier check looked and did
 * not find it, and because a PATCH of an unknown key returns 200 there was nothing to
 * contradict the conclusion.
 *
 * That mistake had a cost. 26 of 28 mailboxes sat with no signature at all, and the postal
 * address and opt-out line §5 requires on every send exist nowhere else — so every one of
 * them would have sent non-compliant mail with nothing in the CRM able to say so.
 */

export const maxDuration = 10;

const num = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

export async function GET(request: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const email = decodeURIComponent((await params).email);

    const [account, analytics, campaigns] = await Promise.all([
      getEmailAccount(email),
      // A mailbox with no warmup history returns an empty map rather than failing; the
      // drawer must still open, so this must not take the whole request down.
      getWarmupAnalytics([email]).catch(() => ({} as WarmupAnalytics)),
      campaignsUsingMailbox(email).catch(() => []),
    ]);

    const byDate = analytics?.email_date_data?.[email] ?? {};
    const agg = analytics?.aggregate_data?.[email] ?? {};

    const daily = Object.entries(byDate)
      .map(([date, v]) => ({
        date,
        sent: v?.sent ?? 0,
        received: v?.received ?? 0,
        landedInbox: v?.landed_inbox ?? 0,
        // What the vendor's own summary calls "saved from spam": messages that were
        // sent but did not land in the inbox and had to be rescued.
        savedFromSpam: Math.max((v?.sent ?? 0) - (v?.landed_inbox ?? 0), 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      success: true,
      account: {
        email: account.email,
        firstName: account.first_name ?? '',
        lastName: account.last_name ?? '',
        /**
         * The HTML the platform stores, verbatim.
         *
         * Handed to the drawer as-is rather than converted to text and back. A round trip
         * through a text conversion decides the formatting on the reader's behalf, and the
         * postal address and opt-out line are exactly the parts a lossy conversion drops.
         */
        signature: ((account as Record<string, unknown>).signature as string | null) ?? '',
        status: account.status ?? null,
        statusLabel: account.setup_pending ? 'Setting up'
          : account.status === 1 ? 'Active'
            : account.status === 2 ? 'Paused'
              : account.status === -1 ? 'Error' : 'Inactive',
        warmupOn: account.warmup_status === 1,
        warmupScore: account.stat_warmup_score ?? null,
        warmupStartedAt: account.timestamp_warmup_start ?? null,
        dailyLimit: account.daily_limit ?? null,
        sendingGap: account.sending_gap ?? null,
        slowRamp: account.enable_slow_ramp ?? false,
        inboxPlacementTestLimit: account.inbox_placement_test_limit ?? null,
        replyTo: account.reply_to ?? '',
        trackingDomain: account.tracking_domain_name ?? '',
        trackingDomainStatus: account.tracking_domain_status ?? null,
        trackingDomainActive: String(account.tracking_domain_status ?? '').toUpperCase().includes('ACTIVE'),
        warmup: {
          increment: account.warmup?.increment ?? '1',
          limit: account.warmup?.limit ?? null,
          replyRate: account.warmup?.reply_rate ?? null,
          warmCtd: account.warmup?.advanced?.warm_ctd ?? false,
          openRate: account.warmup?.advanced?.open_rate ?? 100,
          spamSaveRate: account.warmup?.advanced?.spam_save_rate ?? 100,
          importantRate: account.warmup?.advanced?.important_rate ?? 100,
          weekdayOnly: account.warmup?.advanced?.weekday_only ?? false,
          readEmulation: account.warmup?.advanced?.read_emulation ?? false,
        },
      },
      warmupSummary: {
        received: agg.received ?? 0,
        sent: agg.sent ?? 0,
        landedInbox: agg.landed_inbox ?? 0,
        savedFromSpam: Math.max((agg.sent ?? 0) - (agg.landed_inbox ?? 0), 0),
        healthScore: agg.health_score ?? null,
      },
      warmupDaily: daily,
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        statusLabel: CAMPAIGN_STATUS[c.status] ?? 'Unknown',
      })),
      /**
       * Controls the vendor's UI has but its API does not expose — the drawer says so.
       *
       *  was on this list and should not have been. The API does expose it, on
       * the account object, and PATCH writes it: read, appended to, read back changed, and
       * restored byte-for-byte on a live mailbox. It was listed as unsupported because the
       * earlier check looked for it and did not find it — and the cost of that mistake was
       * 26 of 28 mailboxes sitting with no signature, which means no postal address and no
       * opt-out line on anything they send. Both are required by §5.
       */
      unsupported: ['tags', 'warmupFilterTag'],
    });
  } catch (err) {
    return vendorError(err, 'Could not load that mailbox');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ email: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const email = decodeURIComponent((await params).email);
    const body = await request.json();

    const patch: Record<string, unknown> = {};
    if (typeof body.firstName === 'string') patch.first_name = body.firstName;
    /**
     * The signature, sent as the HTML the editor produced.
     *
     * An empty string is allowed through deliberately, unlike replyTo below: clearing a
     * signature is a thing somebody may genuinely mean, and silently keeping the old one
     * would leave a mailbox signed by whoever used to own it.
     */
    if (typeof body.signature === 'string') patch.signature = body.signature;
    if (typeof body.lastName === 'string') patch.last_name = body.lastName;
    if (num(body.dailyLimit) !== undefined) patch.daily_limit = num(body.dailyLimit);
    if (num(body.sendingGap) !== undefined) patch.sending_gap = num(body.sendingGap);
    if (bool(body.slowRamp) !== undefined) patch.enable_slow_ramp = body.slowRamp;
    if (num(body.inboxPlacementTestLimit) !== undefined) {
      patch.inbox_placement_test_limit = num(body.inboxPlacementTestLimit);
    }

    // reply_to is format-validated by the vendor — an empty string is rejected with
    // 'must match format "email"', so blank means "leave it alone" rather than "clear".
    if (typeof body.replyTo === 'string' && body.replyTo.trim()) {
      patch.reply_to = body.replyTo.trim();
    }

    if (body.warmup && typeof body.warmup === 'object') {
      const w = body.warmup;
      // The vendor REPLACES the warmup object rather than merging, so it is always sent
      // whole. Sending only the changed key silently blanks the rest.
      patch.warmup = {
        limit: num(w.limit) ?? 10,
        increment: String(w.increment ?? '1'),
        reply_rate: num(w.replyRate) ?? 30,
        advanced: {
          warm_ctd: !!w.warmCtd,
          open_rate: num(w.openRate) ?? 100,
          spam_save_rate: num(w.spamSaveRate) ?? 100,
          important_rate: num(w.importantRate) ?? 100,
          weekday_only: !!w.weekdayOnly,
          read_emulation: !!w.readEmulation,
        },
      };
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ success: false, error: 'Nothing to save.' }, { status: 400 });
    }

    await updateEmailAccount(email, patch);
    return NextResponse.json({ success: true, saved: Object.keys(patch) });
  } catch (err) {
    return vendorError(err, 'Could not save that mailbox');
  }
}
