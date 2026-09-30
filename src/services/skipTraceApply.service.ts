import { updateLead, addActivity } from '@/services/storage.service';
import { runBatchData } from './batchData.service';
import { runTracerfy } from '@/services/tracerfy.service';
import { insuredEmails, coInsuredEmails, coInsuredPhones } from './recipients.service';
import { ownerEntityOf, entityTraceRefusal } from '@/lib/ownerEntity';

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
  // Frank (Sep-2026): never trace an entity. Same reason as the missing-name rule above
  // and enforced in the same place — "Maybloom Family Trust" is a name, but not a
  // person's, so the lookup bills and returns nothing. Checked here rather than only in
  // the blast's triage because this function is the last gate before a charge, and the
  // lead card reaches the vendor without passing through triage at all.
  const entity = ownerEntityOf(lead);
  if (entity) return entityTraceRefusal(entity);
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
/**
 * Union of what this run found and what was already on file, newest first, de-duplicated
 * case-insensitively — vendors return the same address in varying case and a duplicate
 * would become a duplicate column in the export.
 */
export function mergeContacts(fresh: string[], existing?: string[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...fresh, ...(Array.isArray(existing) ? existing : [])]) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** How many archived people a lead may accumulate before the oldest are dropped. */
const MAX_PRIOR_PERSONS = 24;

/**
 * Attach the previous trace's people to a fresh payload.
 *
 * Additive on purpose. The stored shape's contract is a top-level `persons` array (read
 * by the reachability rules and address ranking) plus the vendor's own fields such as
 * Tracerfy's `hit` (read by the credit accounting and the blast report). Re-shaping it
 * would break those; adding a sibling key does not.
 */
export function withPriorPersons(fresh: any, existing: any): any {
  if (!fresh || typeof fresh !== 'object') return fresh;

  /**
   * Each archived person is stamped with the tool that found them.
   *
   * Without it the archive is an anonymous pile: a card showing five phone numbers cannot
   * say which vendor produced which, so nobody can tell what the second tool actually
   * added — and a modal that labels everything with one vendor's name reads as though the
   * other vendor's work was thrown away. The tag is written once, here, at the moment the
   * provenance is still known.
   *
   * A Tracerfy payload has no `provider` key (it is the vendor's raw response), so an
   * untagged archive is Tracerfy's by elimination.
   */
  const previousProvider: string = existing?.provider ?? 'tracerfy';
  const tag = (p: any) => (p && typeof p === 'object' && !p._foundBy ? { ...p, _foundBy: previousProvider } : p);

  const prior = [
    ...(Array.isArray(existing?.persons) ? existing.persons.map(tag) : []),
    ...(Array.isArray(existing?.priorPersons) ? existing.priorPersons : []),
  ].slice(0, MAX_PRIOR_PERSONS);
  return prior.length ? { ...fresh, priorPersons: prior } : fresh;
}

/**
 * Build the column patch for one trace result. THE only place a trace turns into
 * columns.
 *
 * It exists because there were two: this service and the admin batch route each built
 * their own update object, so a fix applied here silently missed every lead traced by
 * the batch. That is exactly how the full contact lists came to be stored on one path
 * and dropped on the other. Any new field a trace should persist goes here and both
 * callers get it.
 *
 * Found contacts fill EMPTY slots only — a producer-entered phone or email is never
 * overwritten by vendor data.
 */
export function buildTraceUpdate(
  lead: {
    phone1?: string | null; phone2?: string | null;
    email1?: string | null; email2?: string | null;
    /** What earlier traces already found, so a re-trace adds rather than replaces. */
    emailsAll?: string[] | null; phonesAll?: string[] | null;
    /** The previous trace payload, so its per-person attribution is not thrown away. */
    skipTraceData?: any;
  },
  result: {
    matched: boolean;
    emails?: string[]; phones?: string[];
    raw?: unknown; ownerName?: string | null;
    insuredPatch?: Record<string, unknown>;
  },
  now: Date,
  blast?: { runId: string; createdBy: string | null },
): Record<string, any> {
  const update: Record<string, any> = {
    skipTraced: true,
    skipTracedAt: now,
    deepSkipTracedAt: now,
    // The whole response, so the card can surface DNC / TCPA / carrier / rank per number.
    //
    // The PREVIOUS trace's people are carried forward alongside it. This column was
    // replaced outright on every run, so re-tracing a lead destroyed the earlier vendor's
    // per-person attribution — and that attribution is what decides whether an address
    // belongs to the insured. A lead traced by Tracerfy (which returns a DOB, DNC and
    // carrier flags) and later re-traced by BatchData (which returns none of those) would
    // silently lose them, and an insured address found by the first vendor would stop
    // being counted as the insured's. Bounded, so a lead traced repeatedly cannot grow an
    // unbounded blob in a column that already caused one transfer-quota outage.
    skipTraceData: withPriorPersons(result.raw ?? null, lead.skipTraceData),
    // The name Tracerfy returned. Shown next to the on-file name with an override
    // button; never applied automatically.
    skipTraceOwnerName: result.ownerName ?? null,
    ...(blast ? {
      blastSkipTracedAt: now,
      blastSkipTracedBy: blast.createdBy,
      blastRunId: blast.runId,
    } : {}),
  };

  if (result.phones?.[0] && !lead.phone1) update.phone1 = result.phones[0];
  if (result.phones?.[1] && !lead.phone2) update.phone2 = result.phones[1];
  if (result.emails?.[0] && !lead.email1) update.email1 = result.emails[0];
  if (result.emails?.[1] && !lead.email2) update.email2 = result.emails[1];

  // EVERYTHING the trace returned, not just the two that fit the primary slots.
  //
  // phone1/2 and email1/2 are the insured's own contacts and stay the producer's
  // working numbers; these carry the full list so a trace that found six emails keeps
  // six. Before this, four of them were paid for at 15 credits and then thrown away —
  // 43% of traces in this database returned more than two.
  //
  // Only written on a match: a miss returns empty arrays, and overwriting a populated
  // list with [] would destroy what an earlier successful trace found.
  //
  // MERGED, not replaced. The vendor's answer for the same address genuinely changes
  // between runs — an address that returned five emails in August returned three
  // different ones in September, and one that matched then misses now. Replacing would
  // discard addresses this CRM already paid for and may already be emailing, and
  // absence from one run is weak evidence an address is dead. Newest first, since the
  // current run's ordering puts the named insured's own addresses at the front.
  if (result.matched) {
    if (result.emails?.length) update.emailsAll = mergeContacts(result.emails, lead.emailsAll);
    if (result.phones?.length) update.phonesAll = mergeContacts(result.phones, lead.phonesAll);
  }

  Object.assign(update, result.insuredPatch ?? {});

  /**
   * The co-insured's own contact fields.
   *
   * insuredPatch already carries their NAME and date of birth; their email and phone
   * were left in the household list, so a card could hold suma_sreejith@hotmail.com
   * while the Co-Insured Email box sat empty. Email 2 of the cadence is addressed to
   * this person — an address they can be reached at has to reach a field.
   */
  const afterTrace = { ...lead, ...update } as any;
  Object.assign(update, coInsuredContactPatch(afterTrace, coInsuredEmails(afterTrace), coInsuredPhones(afterTrace)));
  return update;
}

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
  const tracerfy = await runTracerfy(lead as any);
  const now = new Date();

  /**
   * BatchData, only where Tracerfy came back without an address.
   *
   * The condition is "no email", not "no match": a Tracerfy hit that returns phones and
   * no email leaves the lead just as unmailable as a miss, and 478 leads in this book are
   * in exactly that state. Re-running Tracerfy on them returns the same nothing, which is
   * the whole reason for a second source.
   *
   * The payload is stored under a top-level `persons` array because that is what
   * recipients.service reads. BatchData nests its people under results.persons, so
   * storing its response verbatim would leave the addresses present in the record and
   * invisible to every reach count — the same silent shape mismatch that had the
   * Reachability tab reporting 521 against 518.
   *
   * A BatchData failure never loses the Tracerfy result: the trace still persists, and
   * the error is returned so a blast can stop rather than record hundreds of false misses
   * the way the Tracerfy run did when its account ran dry.
   */
  let result: typeof tracerfy = tracerfy;
  let provider: 'tracerfy' | 'batchdata' = 'tracerfy';
  let batchDataError: string | null = null;

  const tracerfyUsable = tracerfy.matched && tracerfy.emails.length > 0;
  if (!tracerfyUsable && process.env.BATCHDATA_API_KEY) {
    try {
      const bd = await runBatchData(lead);
      if (bd.matched && (bd.emails.length > 0 || bd.phones.length > 0)) {
        provider = 'batchdata';
        result = {
          ...tracerfy,
          matched: true,
          emails: bd.emails,
          phones: bd.phones,
          personCount: bd.personCount,
          ownerName: bd.ownerName ?? tracerfy.ownerName,
          insuredPatch: Object.keys(bd.insuredPatch).length ? bd.insuredPatch : tracerfy.insuredPatch,
          raw: { provider: 'batchdata', persons: bd.persons, ownerVerified: bd.ownerVerified, raw: bd.raw },
        };
      }
    } catch (err: any) {
      batchDataError = err?.message ?? 'BatchData call failed';
      console.error(`[skiptrace] BatchData fallback failed for ${lead.propertyId}:`, batchDataError);
    }
  }

  /**
   * "Did this trace gain us something we did not already have?"
   *
   * The email test was a bare email1 column check — the one this project has removed
   * everywhere else that reachability is decided. It is wrong in both directions: a lead
   * holding an address in email2, or inside the trace payload, reads as having none, so an
   * address we already had gets counted as recovered; and the insured's addresses are
   * attributed per person inside that payload, so a CO-INSURED address sitting in email1
   * reads as the insured's.
   *
   * insuredEmails() is what the send list, the push and the reachability report all ask, so
   * this now agrees with them about what "we have an address" means.
   */
  const recoveredPhone = Boolean(result.phones[0] && !lead.phone1);
  const recoveredEmail = Boolean(result.emails[0] && insuredEmails(lead).length === 0);

  const update = buildTraceUpdate(
    lead, result, now,
    blast ? { runId: blast.runId, createdBy } : undefined,
  );

  /**
   * ── Record what the trace gained, not just report it ─────────────────────
   *
   * recoveredPhone and recoveredEmail were computed above, returned for the run's own
   * counters, and never written to the lead. The only writers of those columns were the
   * recovery pipeline and isolate.service, both at the moment a lead LEAVES isolation — so
   * the same real-world fact ("this trace found a number we did not have") was recorded for
   * one code path and silently dropped for the other.
   *
   * Measured on 30 Sep: 1,315 of 1,413 traced leads had recoveredEmail unset, and not one
   * lead anywhere carried `false`. A column that is only ever true or absent cannot be
   * counted, and reading it as "has an email" understated recovery by a factor of thirty —
   * which is how a report went out saying condos traced at 2% when the real figure is 70%.
   *
   * Only written when true. A trace that gained nothing must not stamp `false` over a `true`
   * an earlier trace earned: these say what has ever been recovered for this lead, not what
   * the most recent call happened to return.
   */
  if (recoveredPhone) update.recoveredPhone = true;
  if (recoveredEmail) update.recoveredEmail = true;

  // buildTraceUpdate has already folded insuredPatch into `update`; this local is only
  // for the co-insured name reported back to the caller.
  const insuredPatch = result.insuredPatch ?? {};

  await updateLead(lead.propertyId, update);

  const coInsured = [insuredPatch.owner2FirstName, insuredPatch.owner2LastName]
    .filter(Boolean).join(' ') || null;

  /**
   * A blast says so, on the card.
   *
   * ── Why (Frank, 17 Sep 2026) ────────────────────────────────────────────
   * "Would that have been noted on the activity log?" — asked six times about a mass
   * trace, and nobody in the room could answer from a card. Blast traces WERE being
   * logged, but the row read word-for-word the same as a hand-run trace and `createdBy`
   * was usually empty, so the only honest answer was "open the database". Twenty
   * minutes went into reconstructing what one line could have stated.
   *
   * The run id goes into the metadata as well as the text: it is what groups a run in
   * the Blast Skip Traces report, so a card can be traced to the run and the run back
   * to every card it touched.
   */
  /**
   * WHICH provider produced the data, on the line itself.
   *
   * Two vendors now write the same kind of row. Without naming the one that answered,
   * "is the second source actually recovering anything" can only be settled by reading
   * jsonb — which is the position the blast rows were in before A44.
   */
  const via = provider === 'batchdata' ? ' via BatchData' : '';
  const summary = result.matched
    ? `Skip trace${via}: ${result.phones.length} phone(s), ${result.emails.length} email(s)`
      + `${result.personCount ? `, ${result.personCount} person(s) on loan` : ''}`
      + `${coInsured ? `, co-insured ${coInsured}` : ''}`
    : `Skip trace: no match found${batchDataError ? ' · BatchData fallback errored' : ''}`;

  await addActivity(
    lead.id,
    'skip_trace',
    blast ? `Cohort blast — ${summary.replace(/^Skip trace: /, '')}` : summary,
    {
      phones: result.phones,
      emails: result.emails,
      persons: result.personCount,
      insuredPatch,
      provider,
      ...(batchDataError ? { batchDataError } : {}),
      ...(blast ? { blast: { runId: blast.runId, ranBy: createdBy ?? null } } : {}),
    },
    // A blast that nobody is signed in for still has an author: the run. Left null, the
    // feed showed a timestamp and nothing else, which reads as though it happened by
    // itself — the precise impression that made the mass update feel untraceable.
    (blast ? (createdBy ? `blast · ${createdBy}` : 'blast (system)') : createdBy) ?? undefined,
  );

  return {
    matched: result.matched,
    phones: result.phones,
    emails: result.emails,
    recoveredPhone,
    recoveredEmail,
    coInsured,
    /**
     * TRACERFY's bill, not the combined one.
     *
     * Read off `result` this said 15 whenever the fallback rescued a lead — reporting a
     * charge from a vendor that missed and therefore billed zero. The Blast Skip Traces
     * report quotes this as spend, so it would have overstated Tracerfy's cost by 15
     * credits on precisely the leads Tracerfy failed to trace. BatchData's own billing is
     * not reported in its response and is not guessed at here.
     */
    credits: tracerfy.matched ? 15 : 0,
  };
}

/**
 * Put the co-insured's contact details in the co-insured's own fields.
 *
 * ── Why this is needed ──────────────────────────────────────────────────────
 * A trace returns addresses for a household and the rules attribute them per person, but
 * only the INSURED's ever reached a column. So a card could hold
 * `suma_sreejith@hotmail.com` in its "all emails" list, plainly the co-insured Suma
 * Sreejith's, while the Co-Insured Email box sat empty — the data was in the CRM and not
 * where anyone works. Email 2 of the cadence goes to this person; it needs an address in
 * a field, not a string in a list.
 *
 * Empty slots only. A producer's own entry is never overwritten by vendor data, which is
 * the same rule the insured's slots follow.
 */
export function coInsuredContactPatch(
  leadAfterTrace: any,
  coEmails: string[],
  coPhones: string[],
): Record<string, string> {
  const patch: Record<string, string> = {};
  if (coEmails[0] && !leadAfterTrace.owner2Email) patch.owner2Email = coEmails[0];
  if (coPhones[0] && !leadAfterTrace.owner2Phone) patch.owner2Phone = coPhones[0];
  return patch;
}
