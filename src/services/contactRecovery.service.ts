import crypto from 'crypto';
import { sql } from '@/lib/neon';
import { updateLead, addActivity, getLeadByPropertyId } from '@/services/storage.service';
import { runBatchData } from './batchData.service';
import { mergeContacts, withPriorPersons, coInsuredContactPatch } from './skipTraceApply.service';
import { classifyGradeChange, RECOVERABLE } from './gradeChangeReason';
import { insuredEmails, insuredPhones, coInsuredEmails, coInsuredPhones } from './recipients.service';
import { calculateLeadGrade } from './grade.service';
import { recordGradeChange } from './gradeHistory.service';

/**
 * Contact recovery — a second look at the leads that were downgraded for having no way
 * to reach the insured (register A31 / A42).
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * 188 leads in this book were downgraded with a reason that amounts to "the trace came
 * back empty" — "Trace pulled no contact info nor DOB" and its thirty-odd spellings. 178
 * of them still have no insured email and no insured phone. They are the single largest
 * identified loss in the cohort ledger, and they are the ONLY category a different vendor
 * can do anything about: a lead under a trust or outside carrier appetite stays down no
 * matter how good the trace gets.
 *
 * Tracerfy has already run on these and returned nothing, so this calls BatchData
 * directly rather than going through traceAndApply — routing through the normal path
 * would re-run Tracerfy first and bill 15 credits on any hit before falling back.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * 176 of the 188 carry a manual grade override: a producer looked at the lead and set it
 * to D on purpose. Recovering an email does not retract that judgement, and mass-lifting
 * 176 producer decisions is precisely the kind of unannounced change that cost a meeting
 * on 17 Sep 2026. So the default is to recover the DATA and report which leads have
 * become eligible for a second look. Lifting the overrides is a separate, explicit choice.
 *
 * ── DOB ─────────────────────────────────────────────────────────────────────
 * BatchData's property skip-trace returns no date of birth and no age — verified against
 * the live endpoint, and unknown request keys are silently accepted, so there is no option
 * to switch it on. Tracerfy does return one. A lead downgraded ONLY for a missing DOB
 * therefore cannot be recovered here, and nothing in this service pretends otherwise.
 */

export type RecoveryCandidate = {
  id: string;
  owner: string;
  addressStreet: string | null;
  addressZip: string | null;
  grade: string | null;
  manualGrade: string | null;
  hasInsuredEmail: boolean;
  hasInsuredPhone: boolean;
  hasDob: boolean;
};

export type RecoveryResult = {
  runId: string;
  dryRun: boolean;
  candidates: number;
  attempted: number;
  matched: number;
  recoveredEmail: number;
  recoveredPhone: number;
  /** Recovered contacts but still sitting under a producer's manual D. */
  needsReview: number;
  /** Re-graded automatically because no override stood in the way. */
  regraded: number;
  /** Leads whose DOB is still missing — BatchData cannot supply one. */
  stillNoDob: number;
  errors: { id: string; error: string }[];
};

/**
 * Leads downgraded for missing contact details that still have none.
 *
 * Keyed off the LATEST grade change per lead: a lead downgraded for a trust and later
 * re-graded for something else should not be dragged in by an old row.
 */
export async function findRecoveryCandidates(
  opts: { effFrom?: string; effTo?: string; limit?: number } = {},
): Promise<RecoveryCandidate[]> {
  const { effFrom, effTo, limit = 500 } = opts;

  /**
   * Scoped to the SAME effective-date range the screen is showing.
   *
   * Without this the panel offered to run on every downgraded lead in the book while the
   * table beside it listed six — the button and the list it sits under would have meant
   * different things, and the run would have spent money on cohorts nobody was looking
   * at. A range is how this team works; an action offered next to a filtered list has to
   * honour that filter.
   */
  const from = effFrom || null;
  const to = effTo || null;

  const rows = await sql`
    SELECT DISTINCT ON (l."id")
           l."id", l."grade", l."manualGrade", l."owner1FirstName", l."owner1LastName",
           l."owner2FirstName", l."owner2LastName", l."addressStreet", l."addressZip",
           l."effectiveDate",
           l."email1", l."email2", l."owner2Email",
           l."phone1", l."phone2", l."owner2Phone",
           l."skipTraceData", l."emailsAll", l."owner1Dob",
           g."reason", g."source"
      FROM "GradeChange" g
      JOIN "Lead" l ON l."id" = g."leadId"
     WHERE (${from}::text IS NULL OR l."effectiveDate" >= ${from})
       AND (${to}::text   IS NULL OR l."effectiveDate" <= ${to})
     ORDER BY l."id", g."changedAt" DESC`;

  return (rows as any[])
    .filter((r) => classifyGradeChange(r.reason, r.source) === RECOVERABLE)
    // No address, no lookup — BatchData resolves a person FROM the property.
    .filter((r) => r.addressStreet && r.addressZip)
    // Nothing to recover if we can already reach them.
    .filter((r) => insuredEmails(r).length === 0 || insuredPhones(r).length === 0)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      owner: `${r.owner1FirstName ?? ''} ${r.owner1LastName ?? ''}`.trim(),
      addressStreet: r.addressStreet,
      addressZip: r.addressZip,
      grade: r.grade,
      manualGrade: r.manualGrade,
      hasInsuredEmail: insuredEmails(r).length > 0,
      hasInsuredPhone: insuredPhones(r).length > 0,
      hasDob: !!r.owner1Dob,
    }));
}

/**
 * Run BatchData over the candidates and apply what comes back.
 *
 * `dryRun` reports what would happen and calls nothing — the default, because every call
 * costs money and the last mass operation run without a preview is still being unpicked.
 */
export async function recoverContacts(opts: {
  dryRun?: boolean;
  limit?: number;
  /** Explicitly retract the producer downgrades this recovery invalidates. Default false. */
  liftOverrides?: boolean;
  createdBy?: string | null;
  /** The effective-date range on screen. A run must cover what the operator can see. */
  effFrom?: string;
  effTo?: string;
} = {}): Promise<RecoveryResult> {
  const { dryRun = true, limit = 25, liftOverrides = false, createdBy = null, effFrom, effTo } = opts;
  const runId = crypto.randomUUID();

  const all = await findRecoveryCandidates({ effFrom, effTo });
  const batch = all.slice(0, limit);

  const out: RecoveryResult = {
    runId, dryRun,
    candidates: all.length,
    attempted: 0, matched: 0, recoveredEmail: 0, recoveredPhone: 0,
    needsReview: 0, regraded: 0,
    stillNoDob: batch.filter((c) => !c.hasDob).length,
    errors: [],
  };
  if (dryRun) return out;

  for (const c of batch) {
    const lead = await getLeadByPropertyId(c.id) as any;
    if (!lead) continue;
    out.attempted++;

    let bd;
    try {
      bd = await runBatchData(lead);
    } catch (err: any) {
      // Stop the run rather than record a string of false misses — the Tracerfy blast
      // made ~290 pointless calls after its account ran dry because it kept going.
      out.errors.push({ id: c.id, error: err?.message ?? 'BatchData call failed' });
      break;
    }

    if (!bd.matched || (!bd.emails.length && !bd.phones.length)) continue;
    out.matched++;

    const applied = await applyBatchData(lead, bd, { runId, createdBy, liftOverrides });
    if (applied.gainedEmail) out.recoveredEmail++;
    if (applied.gainedPhone) out.recoveredPhone++;
    if (applied.regradedTo) out.regraded++;
    if (applied.overrideStands) out.needsReview++;
  }

  return out;
}

export type AppliedRecovery = {
  gainedEmail: boolean;
  gainedPhone: boolean;
  regradedTo: string | null;
  overrideStands: boolean;
  emails: string[];
  phones: string[];
};

/**
 * Write one BatchData result onto a lead — the ONLY place that happens.
 *
 * Shared by the batch run and the per-lead button on the card. They started as one code
 * path on purpose: the last time two callers each built their own update object, the full
 * contact lists were stored on one path and silently dropped on the other, and the fix
 * applied to one missed every lead that came through the other.
 */
export async function applyBatchData(
  lead: any,
  bd: { emails: string[]; phones: string[]; persons: any[]; raw?: unknown; ownerName: string | null; ownerVerified: boolean; insuredPatch: Record<string, any> },
  opts: { runId?: string | null; createdBy?: string | null; liftOverrides?: boolean } = {},
): Promise<AppliedRecovery> {
  const { runId = null, createdBy = null, liftOverrides = false } = opts;
  const now = new Date();

  const update: Record<string, any> = {
    skipTraced: true,
    skipTracedAt: now,
    deepSkipTracedAt: now,
    // Normalised to a top-level persons[] — what the reachability rules read. Storing
    // BatchData's own results.persons nesting would leave the addresses invisible.
    // Carries the previous trace's people forward — see withPriorPersons. Without it a
    // BatchData run wiped whatever Tracerfy had attributed to the insured.
    skipTraceData: withPriorPersons(
      { provider: 'batchdata', persons: bd.persons, ownerVerified: bd.ownerVerified, raw: bd.raw },
      lead.skipTraceData,
    ),
    skipTraceOwnerName: bd.ownerName ?? null,
  };
  /**
   * The insured's own fields are filled ONLY when BatchData's person is verifiably ours.
   *
   * See the same gate in recoveryPipeline: BatchData resolves one person per property and
   * it is not always the insured. Writing an unverified address into email1 makes the lead
   * read as recovered and mailable, and the campaign then writes to a stranger under the
   * insured's name. Unverified results are still held in emailsAll/phonesAll.
   */
  // Empty slots only — a producer's own entry is never overwritten by vendor data.
  if (bd.ownerVerified) {
    if (bd.phones[0] && !lead.phone1) update.phone1 = bd.phones[0];
    if (bd.phones[1] && !lead.phone2) update.phone2 = bd.phones[1];
    if (bd.emails[0] && !lead.email1) update.email1 = bd.emails[0];
    if (bd.emails[1] && !lead.email2) update.email2 = bd.emails[1];
  }
  // MERGED, not replaced — the same rule the Tracerfy path has always used. Assigning
  // the fresh list outright discarded every address an earlier trace had paid for, on a
  // lead we may already be emailing.
  if (bd.emails.length) update.emailsAll = mergeContacts(bd.emails, lead.emailsAll);
  if (bd.phones.length) update.phonesAll = mergeContacts(bd.phones, lead.phonesAll);
  if (bd.ownerVerified) Object.assign(update, bd.insuredPatch ?? {});
  // The co-insured's address belongs in the co-insured's field.
  {
    const after = { ...lead, ...update };
    Object.assign(update, coInsuredContactPatch(after, coInsuredEmails(after), coInsuredPhones(after)));
  }

  const gainedEmail = !!update.email1 && !lead.email1;
  const gainedPhone = !!update.phone1 && !lead.phone1;

  /**
   * Re-grade only where no producer decision is in the way.
   *
   * With an override standing, the lead keeps the grade the producer gave it and is
   * flagged for review instead. Recovering an address is evidence their reason no longer
   * holds; it is not authority to overrule them.
   */
  let regradedTo: string | null = null;
  if (lead.manualGrade && liftOverrides) {
    update.manualGrade = null;
    update.gradeOverrideReason = null;
    update.gradeOverrideBy = null;
    update.gradeOverrideAt = null;
  }
  const overrideStands = !!lead.manualGrade && !liftOverrides;
  if (!overrideStands) {
    const computed = calculateLeadGrade({ ...lead, ...update } as any);
    if (computed !== lead.grade) { update.grade = computed; regradedTo = computed; }
  }

  await updateLead(lead.propertyId ?? lead.id, update);

  if (regradedTo) {
    await recordGradeChange({
      leadId: lead.id,
      fromGrade: lead.grade ?? null,
      toGrade: regradedTo,
      source: 'system',
      reason: 'Contact details recovered via BatchData — re-graded by the rules',
      changedBy: 'system: contact recovery',
      at: now,
    }).catch(() => {});
  }

  await addActivity(
    lead.id,
    'contact_recovery',
    `Contact recovery via BatchData: ${bd.phones.length} phone(s), ${bd.emails.length} email(s)`
      + `${regradedTo ? ` · grade ${lead.grade ?? '—'} → ${regradedTo}` : ''}`
      + `${overrideStands ? ` · still manually graded ${lead.manualGrade} — needs review` : ''}`,
    {
      ...(runId ? { recovery: { runId, ranBy: createdBy } } : {}),
      provider: 'batchdata',
      emails: bd.emails,
      phones: bd.phones,
      ownerVerified: bd.ownerVerified,
      // Stated on every row: this vendor has no DOB, so a lead downgraded for a missing
      // one is not fixed even when an email comes back.
      dobRecovered: false,
    },
    createdBy ? `contact recovery · ${createdBy}` : 'contact recovery (system)',
  );

  return { gainedEmail, gainedPhone, regradedTo, overrideStands, emails: bd.emails, phones: bd.phones };
}
