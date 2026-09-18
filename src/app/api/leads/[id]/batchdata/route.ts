import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId } from '@/services/storage.service';
import { runBatchData } from '@/services/batchData.service';
import { applyBatchData } from '@/services/contactRecovery.service';

/**
 * POST /api/leads/[id]/batchdata
 *
 * BatchData skip trace for ONE lead, from the card.
 *
 * ── Why this is not the Deep Skip Trace button ──────────────────────────────
 * That button refuses Grade D — "Skip trace is available on Grade A, B, or C leads" —
 * and the leads that most need a second opinion are D *because the first trace failed*.
 * A lead whose override reads "Trace pulled no contact info nor DOB" is exactly the lead
 * a producer wants to retry, and the rule as written locks them out of it.
 *
 * So grade is not checked here. What is checked is that there is an address to look up:
 * BatchData resolves a person FROM the property, so a lead without street and ZIP cannot
 * be traced at all and should be told so rather than billed for a guaranteed miss.
 *
 * Applies through the same applyBatchData used by the batch run, so the card and the
 * bulk action cannot drift apart.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({} as any));
    const lead = await getLeadByPropertyId(id) as any;
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    if (!lead.addressStreet || !lead.addressZip) {
      return NextResponse.json(
        { success: false, error: 'BatchData looks a person up from the property — this lead has no street and ZIP on file.' },
        { status: 400 },
      );
    }

    const bd = await runBatchData(lead);
    if (!bd.matched || (!bd.emails.length && !bd.phones.length)) {
      return NextResponse.json({
        success: true, matched: false,
        message: 'BatchData found no contact details for this property.',
      });
    }

    const applied = await applyBatchData(lead, bd, {
      createdBy: body?._createdBy ?? null,
      // Never from the card. Retracting a producer's downgrade is a decision, not a
      // side effect of pressing a trace button.
      liftOverrides: false,
    });

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({
      success: true,
      matched: true,
      data: updated,
      emails: applied.emails,
      phones: applied.phones,
      gainedEmail: applied.gainedEmail,
      gainedPhone: applied.gainedPhone,
      regradedTo: applied.regradedTo,
      overrideStands: applied.overrideStands,
      ownerVerified: bd.ownerVerified,
      // BatchData carries no date of birth; say so rather than let a card imply one.
      dobRecovered: false,
    });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/batchdata error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'BatchData trace failed' },
      { status: 500 },
    );
  }
}
