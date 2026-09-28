import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/neon';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { recordVerification, verifiedAddresses } from '@/services/emailVerification.service';
import { insuredEmails, coInsuredEmails } from '@/services/recipients.service';
import { addActivity } from '@/services/storage.service';

/**
 * The verification verdict on a lead's addresses, per person.
 *
 *   GET  /api/leads/{id}/verify-email    what each role's address currently reads
 *   POST /api/leads/{id}/verify-email    { role, status }  — set it by hand
 *
 * ── Why a producer may set this at all ──────────────────────────────────────
 * Verification is ZeroBounce's answer, and ideally nothing else writes it. But the file has
 * not been imported for every batch — 1,143 addresses were on file for the 25 Sep run and
 * 527 were checked — and a producer who has just had an email bounce, or just had a reply,
 * knows something the vendor has not been asked about.
 *
 * ── So the SOURCE is recorded, always ───────────────────────────────────────
 * The cohort ledger counts an account as verified when one of its insured addresses is
 * deliverable. Letting a person write that number without saying so would turn a vendor
 * fact into an opinion that reads identically. Every hand-set verdict therefore carries
 * `source = 'producer · <who>'`, so "verified by ZeroBounce" and "marked by Ruben" can
 * always be told apart afterwards — and a later import overwrites it, because the vendor
 * checking an address is a better answer than somebody remembering it.
 */
export const dynamic = 'force-dynamic';

/** ZeroBounce's own vocabulary. Only 'valid' is deliverable — see the service. */
const STATUSES = new Set([
  'valid', 'invalid', 'catch-all', 'unknown', 'spamtrap', 'abuse', 'do_not_mail',
]);

type Role = 'insured' | 'coInsured';

/**
 * The address a verdict applies to.
 *
 * The FIRST address for that person, which is the one the send list picks. A verdict on an
 * address the campaign will not use would be recorded truthfully and mean nothing — and
 * would make the cohort count move for a reason nobody could find.
 */
function addressFor(lead: Record<string, unknown>, role: Role): string | null {
  const list = role === 'insured' ? insuredEmails(lead) : coInsuredEmails(lead);
  return list[0] ? String(list[0]).trim().toLowerCase() : null;
}

async function leadOf(id: string) {
  const rows = await sql`
    SELECT "id","propertyId","cohort","email1","email2","owner2Email","emailsAll",
           "skipTraceData","owner1FirstName","owner1LastName","owner2FirstName","owner2LastName"
      FROM "Lead" WHERE "id" = ${id} OR "propertyId" = ${id} LIMIT 1` as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const lead = await leadOf(id);
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });

    const verdicts = await verifiedAddresses();
    const forRole = (role: Role) => {
      const email = addressFor(lead, role);
      if (!email) return { email: null, status: null, deliverable: false, source: null };
      const v = verdicts.get(email);
      return {
        email,
        status: v?.status ?? null,
        deliverable: v?.deliverable ?? false,
        source: v?.source ?? null,
        verifiedAt: v?.verifiedAt ?? null,
      };
    };

    return NextResponse.json({
      success: true,
      insured: forRole('insured'),
      coInsured: forRole('coInsured'),
    });
  } catch (error) {
    console.error('GET /api/leads/[id]/verify-email error:', error);
    return NextResponse.json({ success: false, error: 'Could not read the verification' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const role: Role = body?.role === 'coInsured' ? 'coInsured' : 'insured';
    const status = String(body?.status ?? '').trim().toLowerCase();

    if (status && !STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: `Unknown status "${status}".` },
        { status: 400 },
      );
    }

    const lead = await leadOf(id);
    if (!lead) return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });

    const email = addressFor(lead, role);
    if (!email) {
      return NextResponse.json(
        { success: false, error: `This lead has no ${role === 'insured' ? 'insured' : 'co-insured'} email to verify.` },
        { status: 400 },
      );
    }

    const actor = actorLabel(await getSessionUser(request));

    /**
     * An empty status CLEARS the verdict rather than storing "unknown".
     *
     * Those are different facts: "nobody has checked this" and "the checker could not tell"
     * both stop it being mailable, but only the second is a result. Storing 'unknown' for an
     * unchecked address would make the pile of work look done.
     */
    if (!status) {
      await sql`DELETE FROM "EmailVerification" WHERE lower("email") = ${email}`;
      await addActivity(
        String(lead.id), 'note',
        `Email verification cleared for the ${role === 'insured' ? 'insured' : 'co-insured'} (${email})`,
        {}, actor ? `verification · ${actor}` : 'verification',
      );
      return NextResponse.json({ success: true, role, email, status: null, deliverable: false });
    }

    await recordVerification({
      email,
      status,
      leadId: String(lead.id),
      propertyId: lead.propertyId ? String(lead.propertyId) : null,
      cohort: lead.cohort ? String(lead.cohort) : null,
      personRole: role,
      // Named so nobody has to guess later which verdicts a person typed.
      source: actor ? `producer · ${actor}` : 'producer',
      batchLabel: null,
    });

    await addActivity(
      String(lead.id), 'note',
      `Email marked "${status}" for the ${role === 'insured' ? 'insured' : 'co-insured'} (${email}) — set by hand, not by the verifier`,
      { changes: [{ field: `${role} email verification`, from: '—', to: status }] },
      actor ? `verification · ${actor}` : 'verification',
    );

    return NextResponse.json({
      success: true, role, email, status,
      deliverable: status === 'valid',
    });
  } catch (error) {
    console.error('POST /api/leads/[id]/verify-email error:', error);
    return NextResponse.json({ success: false, error: 'Could not save the verification' }, { status: 500 });
  }
}
