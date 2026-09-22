import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { recordBandRating, recordQuote, recordLoss, recordBind, quoteState } from '@/services/quoteOutcomes.service';
import { LOSS_REASONS, type LossReason } from '@/lib/lossReasons';

/**
 * POST /api/leads/{id}/outcome  → { action: 'band' | 'quote' | 'bind' | 'loss', ... }
 *
 * What happens to a lead after Ruben picks up the phone: he prices it, he quotes it, and
 * then it is either sold or lost. One route because it is one workflow and a producer
 * moves between the steps on the same screen.
 *
 * A bind also stops outreach to the household — see recordBind. That is not the caller's
 * job to remember.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json({ success: true, data: await quoteState(id) });
  } catch (error: unknown) {
    console.error('GET /api/leads/[id]/outcome error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not read the outcome' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser(req);
    const by = user?.email ?? null;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const money = (v: unknown) => {
      const n = Number(v);
      // Rejects NaN, negatives and the empty string, which Number() turns into 0 — a
      // premium of zero recorded as real would drag every average it lands in.
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    if (body.action === 'band') {
      const low = money(body.low), high = money(body.high), carrier = str(body.carrier);
      if (!low || !high || !carrier) {
        return NextResponse.json(
          { success: false, error: 'A band needs a low, a high and the carrier it came from.' },
          { status: 400 },
        );
      }
      await recordBandRating({ leadId: id, low, high, carrier, by });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'quote') {
      const premium = money(body.premium), carrier = str(body.carrier);
      if (!premium || !carrier) {
        return NextResponse.json(
          { success: false, error: 'A quote needs the premium and the carrier.' },
          { status: 400 },
        );
      }
      const r = await recordQuote({ leadId: id, premium, carrier, by });
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === 'bind') {
      const premium = money(body.premium), carrier = str(body.carrier);
      if (!premium || !carrier) {
        return NextResponse.json(
          { success: false, error: 'A sale needs the written premium and the carrier.' },
          { status: 400 },
        );
      }
      const effectiveDate = str(body.effectiveDate);
      if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        return NextResponse.json(
          { success: false, error: 'The effective date must be YYYY-MM-DD.' },
          { status: 400 },
        );
      }
      const r = await recordBind({
        leadId: id, premium, carrier,
        policyNumber: str(body.policyNumber),
        effectiveDate,
        notes: str(body.notes),
        by,
      });
      /**
       * A failed suppression is reported as a WARNING on a successful response, not as an
       * error. The sale is recorded either way and must not look like it failed — but a
       * bound customer still receiving cold email is exactly the thing this is for, so it
       * cannot be swallowed either.
       */
      return NextResponse.json({
        success: true,
        ...r,
        warning: r.suppressionError
          ? `The sale was recorded, but outreach was NOT stopped: ${r.suppressionError}. Stop it by hand before the next send.`
          : null,
      });
    }

    if (body.action === 'loss') {
      const reason = str(body.reason);
      if (!reason || !LOSS_REASONS.some((x) => x.key === reason)) {
        return NextResponse.json(
          { success: false, error: `Unknown loss reason: ${reason ?? '(none)'}` },
          { status: 400 },
        );
      }
      const r = await recordLoss({
        leadId: id,
        reason: reason as LossReason,
        competingCarrier: str(body.competingCarrier),
        competingPremium: money(body.competingPremium),
        ourQuotedPremium: money(body.ourQuotedPremium),
        notes: str(body.notes),
        by,
      });
      return NextResponse.json({ success: true, ...r });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error: unknown) {
    console.error('POST /api/leads/[id]/outcome error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not record the outcome' },
      { status: 500 },
    );
  }
}
