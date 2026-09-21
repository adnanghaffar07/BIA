import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/neon';
import { getSessionUser } from '@/lib/auth';
import { callState, logAttempt } from '@/services/callLog.service';
import { CALL_OUTCOMES, type CallOutcome } from '@/lib/callOutcomes';

/**
 * GET  /api/leads/{id}/calls   → every attempt, plus the derived state
 * POST /api/leads/{id}/calls   → log one attempt
 *
 * The lead is loaded here and passed whole into the service, because the number rules and
 * the suppression check both read the recipient columns — a partial row reads as "no
 * phone" and would tell a producer there is nobody to call.
 */

const LEAD_COLS = `"id","propertyId","owner1FirstName","owner1LastName",
  "owner2FirstName","owner2LastName","addressStreet","addressCity","addressZip",
  "phone1","phone2","owner2Phone","phonesAll",
  "email1","email2","owner2Email","emailsAll","skipTraceData",
  "invalidPhones","callUnreachableAt","revisitFlag","revisitDate"`;

async function loadLead(id: string) {
  const rows = await sql`
    SELECT "id","propertyId","owner1FirstName","owner1LastName",
           "owner2FirstName","owner2LastName","addressStreet","addressCity","addressZip",
           "phone1","phone2","owner2Phone","phonesAll",
           "email1","email2","owner2Email","emailsAll","skipTraceData",
           "invalidPhones","callUnreachableAt","revisitFlag","revisitDate"
      FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1` as Array<Record<string, unknown>>;
  void LEAD_COLS;
  return rows[0] ?? null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const lead = await loadLead(id);
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: await callState(lead) });
  } catch (error: unknown) {
    console.error('GET /api/leads/[id]/calls error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not read call history' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await getSessionUser(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const str = (v: unknown): string | null =>
      (typeof v === 'string' && v.trim() ? v.trim() : null);

    const outcome = str(body.outcome);
    const numberDialled = str(body.numberDialled);
    if (!outcome || !numberDialled) {
      return NextResponse.json(
        { success: false, error: 'An attempt needs the number dialled and the outcome.' },
        { status: 400 },
      );
    }
    // Checked against the list rather than cast: an unknown outcome would be written and
    // then read back later as something no follow-up rule knows how to act on.
    if (!CALL_OUTCOMES.some((o) => o.key === outcome)) {
      return NextResponse.json({ success: false, error: `Unknown outcome: ${outcome}` }, { status: 400 });
    }

    const lead = await loadLead(id);
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });

    const result = await logAttempt({
      lead,
      numberDialled,
      outcome: outcome as CallOutcome,
      numberRole: (str(body.numberRole) as 'insured' | 'co_insured' | null) ?? null,
      numberLabel: str(body.numberLabel),
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
      callbackAt: str(body.callbackAt),
      notes: str(body.notes),
      by: user?.email ?? null,
    });

    const fresh = await loadLead(id);
    return NextResponse.json({ success: true, ...result, data: await callState(fresh!) });
  } catch (error: unknown) {
    console.error('POST /api/leads/[id]/calls error:', error);
    return NextResponse.json(
      { success: false, error: (error instanceof Error ? error.message : null) || 'Could not log the attempt' },
      { status: 500 },
    );
  }
}
