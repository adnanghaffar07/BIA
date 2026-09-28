import { sql } from '@/lib/neon';
import { addActivity } from '@/services/storage.service';
import { EMAIL_RE } from './recipients.service';

/**
 * An address taken from the homeowner, on the phone (Frank, 25 Sep 2026).
 *
 * "We should have a field, especially for the 72 rated accounts we will call first with no
 *  email to contact, within the CRM card which allows for us to manually input the insured
 *  and co insured email info while on the phone."
 *
 * ── Why this is not just an edit box ────────────────────────────────────────
 * An address the customer says out loud is the best evidence this system will ever hold. It
 * outranks a skip trace, a tax roll and a verifier — all of which are guesses about who owns
 * a mailbox, where this is the owner telling us. So it is recorded as CONFIRMED rather than
 * written into the address columns and left to compete with the guesses:
 *
 *   - the send list already prefers confirmedEmail over everything else (Sec. 7.1)
 *   - the surname review never sees it, because that queue only holds trace-recovered
 *     addresses — an address given by the person it belongs to has nothing to check
 *   - a later trace cannot quietly displace it
 *
 * ── What happens to an address that was already there ───────────────────────
 * It is replaced, and the old value goes into the activity trail. On the 72 there is
 * nothing to replace; elsewhere, a producer who has the customer on the phone has better
 * information than whatever was on the card, and pretending otherwise would mean typing the
 * right answer into a system that keeps using the wrong one.
 */

export type CaptureResult = {
  insuredSet: boolean;
  coInsuredSet: boolean;
  confirmed: 'insured' | 'co_insured' | null;
  replaced: Array<{ role: string; was: string }>;
};

const clean = (e: unknown) => String(e ?? '').trim().toLowerCase();

export async function captureEmails(input: {
  lead: Record<string, unknown>;
  insuredEmail?: string | null;
  coInsuredEmail?: string | null;
  by?: string | null;
}): Promise<CaptureResult> {
  const leadId = String(input.lead.id);
  const insured = clean(input.insuredEmail);
  const co = clean(input.coInsuredEmail);

  if (!insured && !co) throw new Error('Give at least one address.');
  for (const [label, e] of [['insured', insured], ['co-insured', co]] as const) {
    if (e && !EMAIL_RE.test(e)) throw new Error(`That ${label} address does not look like an email.`);
  }
  if (insured && co && insured === co) {
    /**
     * One mailbox cannot be two people. Allowing it would put the same address in the
     * campaign twice, and §1.5 caps a household at two recipients precisely to avoid that.
     */
    throw new Error('The insured and co-insured cannot share one address.');
  }

  const replaced: CaptureResult['replaced'] = [];
  const wasInsured = clean(input.lead.email1);
  const wasCo = clean(input.lead.owner2Email);
  if (insured && wasInsured && wasInsured !== insured) replaced.push({ role: 'insured', was: wasInsured });
  if (co && wasCo && wasCo !== co) replaced.push({ role: 'co-insured', was: wasCo });

  /**
   * The insured is confirmed where we have one, otherwise the co-insured.
   *
   * Only one address can be the confirmed one, and §1.5 makes the insured the primary
   * recipient — a co-insured is promoted only when the insured has nothing.
   */
  const confirmed: CaptureResult['confirmed'] = insured ? 'insured' : (co ? 'co_insured' : null);
  const confirmedEmail = insured || co;

  await sql`
    UPDATE "Lead"
       SET "email1"         = COALESCE(${insured || null}, "email1"),
           "owner2Email"    = COALESCE(${co || null}, "owner2Email"),
           "confirmedEmail" = ${confirmedEmail},
           "confirmedRole"  = ${confirmed},
           "confirmedVia"   = 'call',
           "confirmedAt"    = NOW(),
           "lastEditedBy"   = ${input.by ?? null},
           "updatedAt"      = NOW()
     WHERE "id" = ${leadId}`;

  /**
   * The trail carries the old values, so nothing is lost by replacing them — and carries
   * who took them, because "the customer told me" is only worth anything if we know who
   * they told.
   */
  await addActivity(
    leadId,
    'note',
    `Address taken on a call: ${[
      insured ? `insured ${insured}` : null,
      co ? `co-insured ${co}` : null,
    ].filter(Boolean).join(', ')}`
      + (replaced.length
        ? ` — replaced ${replaced.map((r) => `${r.role} ${r.was}`).join(', ')}`
        : ''),
    {
      changes: [
        ...(insured ? [{ field: 'Insured email', from: wasInsured || '—', to: insured }] : []),
        ...(co ? [{ field: 'Co-insured email', from: wasCo || '—', to: co }] : []),
      ],
      confirmedVia: 'call',
    },
    input.by ?? undefined,
  ).catch(() => { /* the address is the point; a missing trail entry must not lose it */ });

  return {
    insuredSet: Boolean(insured),
    coInsuredSet: Boolean(co),
    confirmed,
    replaced,
  };
}
