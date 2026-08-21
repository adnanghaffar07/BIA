import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { canRunSkipTrace } from '@/services/grade.service';
import { runTracerfy } from '@/services/tracerfy.service';

/**
 * POST /api/leads/[id]/skip-trace
 *
 * Runs a Tracerfy skip trace for one lead (5 credits per hit). Frank Aug-2026:
 * Tracerfy REPLACED the REAPI skip trace, whose data was corrupt. Gated by
 * canRunSkipTrace(): only carrier-qualified leads that haven't already been
 * traced. Found phone/email fill the empty contact slots without clobbering
 * any producer-entered values, then flags skipTraced + logs an activity.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // ?deep=1 → Tracerfy enhanced tier (15 credits). Frank Aug-2026: available on ALL leads
    // (any grade, traced or not) — it's a deliberate, per-lead recovery a producer chooses.
    const deep = request.nextUrl.searchParams.get('deep') === '1';

    if (!deep && !canRunSkipTrace(lead as any)) {
      return NextResponse.json(
        {
          success: false,
          error: (lead as any).skipTraced
            ? 'This lead has already been skip traced.'
            : 'Skip trace is available on Grade A, B, or C leads.',
        },
        { status: 400 },
      );
    }

    let payload: any = {};
    try { payload = await request.json(); } catch { /* body optional */ }
    const createdBy = payload?._createdBy;

    const result = await runTracerfy(lead as any, { deep });

    const now = new Date();
    const update: Record<string, any> = {
      skipTraced: true,
      skipTracedAt: now,
      // Persist the entire Tracerfy response so the page can surface every field
      // (DNC / TCPA / carrier / rank on each number).
      skipTraceData: result.raw ?? null,
      // The insured name Tracerfy returned — the card compares it to the on-file name and
      // offers a manual override if they differ. Never auto-overwrites the insured name.
      skipTraceOwnerName: result.ownerName ?? null,
    };
    // Fill empty slots only — never overwrite producer-entered contact info.
    if (result.phones[0] && !(lead as any).phone1) update.phone1 = result.phones[0];
    if (result.phones[1] && !(lead as any).phone2) update.phone2 = result.phones[1];
    if (result.emails[0] && !(lead as any).email1) update.email1 = result.emails[0];
    if (result.emails[1] && !(lead as any).email2) update.email2 = result.emails[1];

    // Co-insured ("people on loan") + DOB into Insured Info — computed in the service.
    const insuredPatch = result.insuredPatch ?? {};
    const personCount = result.personCount;
    Object.assign(update, insuredPatch);

    await updateLead(id, update);
    const coInsuredName = [insuredPatch.owner2FirstName, insuredPatch.owner2LastName].filter(Boolean).join(' ');
    await addActivity(
      (lead as any).id,
      'skip_trace',
      result.matched
        ? `${deep ? 'Deep skip trace' : 'Skip trace'}: ${result.phones.length} phone(s), ${result.emails.length} email(s)`
          + `${personCount ? `, ${personCount} person(s) on loan` : ''}`
          + `${coInsuredName ? `, co-insured ${coInsuredName}` : ''}`
        : `${deep ? 'Deep skip trace' : 'Skip trace'}: no match found`,
      { phones: result.phones, emails: result.emails, persons: personCount, insuredPatch },
      createdBy,
    );

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({
      success: true,
      data: updated,
      result: { phones: result.phones, emails: result.emails, matched: result.matched },
    });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/skip-trace error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Skip trace failed' },
      { status: 500 },
    );
  }
}
