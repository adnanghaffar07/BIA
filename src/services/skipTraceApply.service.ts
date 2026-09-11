import { updateLead, addActivity } from '@/services/storage.service';
import { runTracerfy } from '@/services/tracerfy.service';

/**
 * One place where a deep skip trace is decided and written.
 *
 * Both callers use this — the Deep Skip Trace button on the lead card and the
 * Grade-A blast on the Leads page. They used to be separate copies of the same
 * twenty lines, which is exactly how regrade.mjs drifted away from
 * grade.service.ts and started downgrading every condo it touched. One function,
 * so a change to the trace rules reaches both callers or neither.
 *
 * Tracerfy bills 15 credits for a HIT and 0 for a miss, so a trace that finds
 * nothing is free. That asymmetry is why the blast quotes a ceiling rather than
 * a cost, and why re-running a single lead is cheap enough to allow.
 */

/** Grade that actually applies — a producer's manual override wins. */
export function effectiveGrade(lead: any): string {
  return String(lead?.manualGrade || lead?.grade || '');
}

/**
 * Why this lead can't be traced, or null if it can.
 * Kept as a reason string so every surface (card, blast preview, API) shows the
 * same wording instead of inventing its own.
 */
export function skipTraceBlocker(lead: any, opts?: { grades?: string[]; skipIfTraced?: boolean }): string | null {
  const grades = opts?.grades ?? ['A', 'B', 'C'];
  if (!grades.includes(effectiveGrade(lead))) {
    // "Grade A" / "Grade A or B" / "Grade A, B or C" — reads like a sentence, not a list.
    const named = grades.length < 2
      ? grades[0]
      : `${grades.slice(0, -1).join(', ')} or ${grades[grades.length - 1]}`;
    return `Skip trace is available on Grade ${named} leads.`;
  }
  // The enhanced endpoint keys off the named insured, so no name means no lookup.
  if (!String(lead?.owner1FirstName ?? '').trim() || !String(lead?.owner1LastName ?? '').trim()) {
    return 'Skip trace needs the insured first and last name on file.';
  }
  // Only the blast sets this. A single lead may be re-run deliberately (Frank
  // Sep-2026) so a producer can verify an empty result rather than trust it; at
  // blast scale the same permissiveness would re-charge a whole cohort.
  if (opts?.skipIfTraced && lead?.deepSkipTracedAt) {
    return 'Already deep skip traced.';
  }
  return null;
}

export type SkipTraceOutcome = {
  matched: boolean;
  phones: string[];
  emails: string[];
  /** Contact that landed in an empty slot — what the trace actually gained us. */
  recoveredPhone: boolean;
  recoveredEmail: boolean;
  coInsured: string | null;
  /** 15 on a hit, 0 on a miss — what Tracerfy actually billed. */
  credits: number;
};

/**
 * Run the deep trace for one lead and persist the result.
 * Found contacts fill EMPTY slots only — a producer-entered phone or email is
 * never overwritten by vendor data.
 */
export async function traceAndApply(
  lead: any,
  createdBy: string | null,
  /**
   * Present when this trace is part of a cohort blast. Stamps who ran it and which
   * run it belonged to, so a blast-traced lead can be told apart from one a producer
   * traced by hand — deepSkipTracedAt alone cannot say which. The card button passes
   * nothing, leaving all three columns NULL.
   */
  blast?: { runId: string },
): Promise<SkipTraceOutcome> {
  const result = await runTracerfy(lead as any);
  const now = new Date();

  const update: Record<string, any> = {
    skipTraced: true,
    skipTracedAt: now,
    deepSkipTracedAt: now,
    // The whole response, so the card can surface DNC / TCPA / carrier / rank per number.
    skipTraceData: result.raw ?? null,
    // The name Tracerfy returned. Shown next to the on-file name with an override
    // button; never applied automatically.
    skipTraceOwnerName: result.ownerName ?? null,
    ...(blast ? {
      blastSkipTracedAt: now,
      blastSkipTracedBy: createdBy,
      blastRunId: blast.runId,
    } : {}),
  };

  const recoveredPhone = Boolean(result.phones[0] && !lead.phone1);
  const recoveredEmail = Boolean(result.emails[0] && !lead.email1);
  if (result.phones[0] && !lead.phone1) update.phone1 = result.phones[0];
  if (result.phones[1] && !lead.phone2) update.phone2 = result.phones[1];
  if (result.emails[0] && !lead.email1) update.email1 = result.emails[0];
  if (result.emails[1] && !lead.email2) update.email2 = result.emails[1];

  const insuredPatch = result.insuredPatch ?? {};
  Object.assign(update, insuredPatch);

  await updateLead(lead.propertyId, update);

  const coInsured = [insuredPatch.owner2FirstName, insuredPatch.owner2LastName]
    .filter(Boolean).join(' ') || null;

  await addActivity(
    lead.id,
    'skip_trace',
    result.matched
      ? `Skip trace: ${result.phones.length} phone(s), ${result.emails.length} email(s)`
        + `${result.personCount ? `, ${result.personCount} person(s) on loan` : ''}`
        + `${coInsured ? `, co-insured ${coInsured}` : ''}`
      : 'Skip trace: no match found',
    { phones: result.phones, emails: result.emails, persons: result.personCount, insuredPatch },
    createdBy ?? undefined,
  );

  return {
    matched: result.matched,
    phones: result.phones,
    emails: result.emails,
    recoveredPhone,
    recoveredEmail,
    coInsured,
    credits: result.matched ? 15 : 0,
  };
}
