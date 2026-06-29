import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { canRunSkipTrace } from '@/services/grade.service';
import { runSkipTrace, insuredPatchFromPersons } from '@/services/skipTrace.service';

/**
 * POST /api/leads/[id]/skip-trace
 *
 * Runs a REAPI skip trace for one lead (consumes credits). Gated by
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

    if (!canRunSkipTrace(lead as any)) {
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

    const result = await runSkipTrace(lead as any);

    const now = new Date();
    const update: Record<string, any> = {
      skipTraced: true,
      skipTracedAt: now,
      // Persist the entire REAPI response so the page can surface every field.
      skipTraceData: result.raw ?? null,
    };
    // Fill empty slots only — never overwrite producer-entered contact info.
    if (result.phones[0] && !(lead as any).phone1) update.phone1 = result.phones[0];
    if (result.phones[1] && !(lead as any).phone2) update.phone2 = result.phones[1];
    if (result.emails[0] && !(lead as any).email1) update.email1 = result.emails[0];
    if (result.emails[1] && !(lead as any).email2) update.email2 = result.emails[1];

    // Pull through the co-insured ("people on loan") + DOB into Insured Info.
    const persons = Array.isArray((result.raw as any)?.persons) ? (result.raw as any).persons : [];
    const insuredPatch = insuredPatchFromPersons(persons, lead);
    Object.assign(update, insuredPatch);

    await updateLead(id, update);
    const coInsuredName = [insuredPatch.owner2FirstName, insuredPatch.owner2LastName].filter(Boolean).join(' ');
    await addActivity(
      (lead as any).id,
      'skip_trace',
      result.matched
        ? `Skip trace: ${result.phones.length} phone(s), ${result.emails.length} email(s)`
          + `${persons.length ? `, ${persons.length} person(s) on loan` : ''}`
          + `${coInsuredName ? `, co-insured ${coInsuredName}` : ''}`
        : 'Skip trace: no match found',
      { phones: result.phones, emails: result.emails, persons: persons.length, insuredPatch },
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
