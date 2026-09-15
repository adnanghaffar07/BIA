import { NextRequest, NextResponse } from 'next/server';
import {
  setWarmup, pauseEmailAccount, resumeEmailAccount,
  markEmailAccountFixed, deleteEmailAccount, listEmailAccounts,
} from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * Actions on sending mailboxes.
 *
 * POST /api/lead-campaigns/accounts/actions
 *   { action: 'warmup', emails: [...], on: boolean }
 *   { action: 'pause' | 'resume' | 'markFixed', emails: [...] }
 *   { action: 'delete', emails: [...], confirm: '<the address>' }
 *
 * One route rather than five, because these all address the same resource and differ
 * only in verb; the alternative is five near-identical files each repeating the auth
 * gate and the vendor error mapping.
 *
 * Delete is the only one that cannot be undone. A mailbox is a paid, warmed asset with
 * months of reputation behind it — deleting one is not "removing it from a campaign",
 * it removes the sending account entirely. So it takes a typed confirmation of the
 * exact address and refuses more than one at a time, which rules out a mis-click
 * wiping a domain's worth of senders.
 */

export const maxDuration = 10;

/** Deleting is per-address and deliberately un-batchable. */
const DELETE_LIMIT = 1;
/** Everything else is reversible, but still bounded so one call cannot walk the estate. */
const BULK_LIMIT = 50;

type Body = {
  action?: string;
  emails?: unknown;
  on?: unknown;
  confirm?: unknown;
};

export async function POST(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const body = (await request.json()) as Body;
    const action = String(body.action ?? '');
    const emails = Array.isArray(body.emails)
      ? body.emails.map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean)
      : [];

    if (!emails.length) {
      return NextResponse.json({ success: false, error: 'No mailbox was given.' }, { status: 400 });
    }

    // Only act on addresses that are really in this workspace. Without this the vendor
    // happily accepts a warmup job for an address that does not exist and reports
    // success, so a typo would read as "done" and silently do nothing.
    const known = new Set((await listEmailAccounts()).map((a) => String(a.email ?? '').toLowerCase()));
    const unknown = emails.filter((e) => !known.has(e));
    if (unknown.length) {
      return NextResponse.json(
        { success: false, error: `Not a mailbox in this workspace: ${unknown.slice(0, 3).join(', ')}` },
        { status: 400 },
      );
    }

    switch (action) {
      case 'warmup': {
        if (emails.length > BULK_LIMIT) {
          return NextResponse.json({ success: false, error: `At most ${BULK_LIMIT} at a time.` }, { status: 400 });
        }
        const on = body.on === true;
        await setWarmup(emails, on);
        return NextResponse.json({
          success: true,
          action, on, count: emails.length,
          // The vendor queues this as a background job and returns a job id rather than
          // the new state, so the caller must re-read rather than trust an echo.
          note: 'Warmup changes are queued by the platform and can take a moment to show.',
        });
      }

      case 'pause':
      case 'resume':
      case 'markFixed': {
        if (emails.length > BULK_LIMIT) {
          return NextResponse.json({ success: false, error: `At most ${BULK_LIMIT} at a time.` }, { status: 400 });
        }
        const run = action === 'pause' ? pauseEmailAccount
          : action === 'resume' ? resumeEmailAccount
            : markEmailAccountFixed;

        const results: Array<{ email: string; ok: boolean; error?: string }> = [];
        for (const email of emails) {
          try {
            await run(email);
            results.push({ email, ok: true });
          } catch (err) {
            // One bad mailbox must not fail the rest — report per address.
            results.push({ email, ok: false, error: err instanceof Error ? err.message : 'failed' });
          }
        }
        return NextResponse.json({
          success: true, action,
          succeeded: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      }

      case 'delete': {
        if (emails.length > DELETE_LIMIT) {
          return NextResponse.json(
            { success: false, error: 'Delete one mailbox at a time.' },
            { status: 400 },
          );
        }
        const email = emails[0];
        if (String(body.confirm ?? '').trim().toLowerCase() !== email) {
          return NextResponse.json(
            { success: false, error: `Type the address exactly (${email}) to confirm deletion.` },
            { status: 400 },
          );
        }
        await deleteEmailAccount(email);
        return NextResponse.json({ success: true, action, deleted: email });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (err) {
    return vendorError(err, 'Could not update the mailbox');
  }
}
