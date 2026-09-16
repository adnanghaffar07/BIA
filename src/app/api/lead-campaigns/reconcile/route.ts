import { NextRequest, NextResponse } from 'next/server';
import { reconcileSentContent, backfillEventCohorts } from '@/services/campaignContent.service';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * POST /api/lead-campaigns/reconcile — fill in which mailbox sent each email and what
 * it said, from the platform's message feed.
 *
 * Reconciliation rather than live capture, because the webhook cannot be relied on as
 * the only source: it is not pointed at production yet, and even once it is, a single
 * delivery attempt to an endpoint that can be down or redeployed is not a record. This
 * is the part that can be re-run until the numbers are right.
 *
 * Safe to run repeatedly and safe to interrupt: every write is COALESCE, so a field that
 * already holds the copy as delivered is never overwritten by a campaign that has since
 * been edited.
 *
 *   ?campaignId=…      restrict to one campaign (verified to actually filter server-side)
 *   ?startingAfter=…   resume from a previous response's nextCursor
 *   ?pages=…           feed pages this call may walk (default 5, max 20)
 */

/** Same 10s budget as every other vendor-facing route; the response carries a cursor
 *  so a long feed is walked across several calls rather than timing out in one. */
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const q = request.nextUrl.searchParams;
    const pagesRaw = Number(q.get('pages'));

    const result = await reconcileSentContent({
      campaignId: q.get('campaignId')?.trim() || undefined,
      startingAfter: q.get('startingAfter')?.trim() || undefined,
      maxPages: Number.isFinite(pagesRaw) && pagesRaw > 0 ? pagesRaw : undefined,
    });

    // Cheap, and the failure it guards against — a send missing from a cohort's totals —
    // is one nobody would spot by reading the report.
    const cohortsFilled = await backfillEventCohorts();

    return NextResponse.json({ success: true, ...result, cohortsFilled });
  } catch (err) {
    return vendorError(err, 'Could not reconcile sent email content');
  }
}
