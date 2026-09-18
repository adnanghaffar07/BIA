import { sql } from '@/lib/neon';
import { updateLead, addActivity } from '@/services/storage.service';
import { insuredEmails } from './recipients.service';

/**
 * Isolating the unreachable (register A41).
 *
 * ── What "isolated" means ───────────────────────────────────────────────────
 * Grade A with no insured email: a lead we would quote and cannot email. It is not lost,
 * not out of appetite, and not a producer's mistake — it is waiting on a contact detail.
 * Left at 'rated' it reads as part of the send list, and the first anyone learns otherwise
 * is when a cohort under-delivers against its own forecast.
 *
 * ── Why the previous status is preserved ────────────────────────────────────
 * In the 10/05 week, 31 of the 34 are already 'rated' and one is 'referral'. Overwriting
 * that would erase work a producer has done, and the email cadence is built on it — a
 * rated lead gets an indicative price in email 2 and an unrated one cannot. So
 * isolatedFromStatus carries what the lead was, isolation is reversible, and the moment
 * an address turns up the lead goes back to being exactly what it was before.
 *
 * ── Why this is an action, not a rule ───────────────────────────────────────
 * It would be easy to have the report isolate leads as it renders them. That would make
 * running a report change the data, which is how a screen stops being a reliable place to
 * look. Somebody presses the button; it is recorded; it can be undone.
 */

const GRADE_A = (l: any) => String(l.manualGrade || l.grade || '') === 'A';

/** Grade A, no insured email, not already isolated. */
function isTarget(l: any): boolean {
  return GRADE_A(l) && insuredEmails(l).length === 0 && l.status !== 'isolated';
}

/** An isolated lead that can now be reached — isolation no longer applies. */
function isRestorable(l: any): boolean {
  return l.status === 'isolated' && insuredEmails(l).length > 0;
}

/**
 * Named columns, not SELECT *: this reads the whole book when no range is given, and the
 * star drags rawData — a large blob on every one of ~10,000 leads — for columns nothing
 * here touches. skipTraceData IS needed; it carries the per-person attribution that
 * decides whether an address belongs to the insured.
 */
async function scoped(effFrom?: string, effTo?: string): Promise<any[]> {
  const from = effFrom || null;
  const to = effTo || null;
  const rows = await sql`
    SELECT "id","propertyId","status","grade","manualGrade","effectiveDate",
           "email1","email2","owner2Email","phone1","phone2","owner2Phone",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
           "skipTraceData","emailsAll","isolatedAt","isolatedFromStatus","isolatedReason",
           -- REQUIRED, not cosmetic: the enrolment stage is decided on it. Unselected it
           -- reads undefined, every lead files as "never traced", and the pipeline queues
           -- 29 leads for the vendor that already failed on them.
           "deepSkipTracedAt"
      FROM "Lead"
     WHERE (${from}::text IS NULL OR "effectiveDate" >= ${from})
       AND (${to}::text   IS NULL OR "effectiveDate" <= ${to})`;
  return rows as any[];
}

export type IsolateResult = {
  dryRun: boolean;
  /** Grade A, no insured email, not yet isolated. */
  candidates: number;
  isolated: number;
  /** Already isolated and now reachable — put back where they were. */
  restored: number;
  /** What the isolated leads were before, so the cadence split is not lost. */
  fromStatus: Record<string, number>;
};

export async function isolateUnreachable(opts: {
  effFrom?: string;
  effTo?: string;
  dryRun?: boolean;
  createdBy?: string | null;
} = {}): Promise<IsolateResult> {
  const { effFrom, effTo, dryRun = true, createdBy = null } = opts;

  const rows = await scoped(effFrom, effTo);
  const targets = rows.filter(isTarget);
  const restorable = rows.filter(isRestorable);

  const fromStatus: Record<string, number> = {};
  for (const l of targets) {
    const k = l.status ?? '(none)';
    fromStatus[k] = (fromStatus[k] ?? 0) + 1;
  }

  const out: IsolateResult = {
    dryRun,
    candidates: targets.length,
    isolated: 0,
    restored: restorable.length,
    fromStatus,
  };
  if (dryRun) return out;

  const now = new Date();
  for (const l of targets) {
    await updateLead(l.propertyId ?? l.id, {
      status: 'isolated',
      isolatedAt: now,
      isolatedFromStatus: l.status ?? null,
      isolatedReason: 'Grade A with no insured email — cannot be emailed',
      /**
       * Enrol at the stage that reflects what has ALREADY been tried.
       *
       * A lead is usually isolated precisely because a deep trace ran and came back
       * without an address — 29 of the first 31 had already been through Tracerfy. Filing
       * those at the "not yet attempted" stage would queue them for the very vendor that
       * already failed on them, at 15 credits a match, and the blast rules elsewhere in
       * this codebase refuse that (skipTraceBlocker's skipIfTraced) for the same reason.
       *
       * So Tracerfy's stage means "never deep traced". Anything already traced starts
       * where it actually stands: Tracerfy has had its turn, BatchData is next. The
       * timestamp is the real one from that trace, not the moment of enrolment.
       */
      recoveryStage: l.deepSkipTracedAt ? 'tracerfy' : 'isolated',
      recoveryEnteredAt: now,
      ...(l.deepSkipTracedAt ? { recoveryTracerfyAt: l.deepSkipTracedAt } : {}),
    });
    await addActivity(
      l.id,
      'status_change',
      `Status: ${l.status ?? '—'} → isolated (Grade A, no insured email)`,
      {
        changes: [{ field: 'Status', from: l.status ?? '(empty)', to: 'isolated' }],
        isolatedFromStatus: l.status ?? null,
      },
      createdBy ? `isolate · ${createdBy}` : 'isolate (system)',
    );
    out.isolated++;
  }

  /**
   * Put back anything that has since become reachable.
   *
   * Isolation describes a condition, not a verdict. A lead that gains an email through a
   * BatchData recovery is no longer unreachable, and leaving it parked would quietly
   * withhold a lead the campaign should have.
   */
  for (const l of restorable) {
    const back = l.isolatedFromStatus || 'new';
    await updateLead(l.propertyId ?? l.id, {
      status: back,
      isolatedAt: null,
      isolatedFromStatus: null,
      isolatedReason: null,
      // Reachable again by other means — it leaves the pipeline the same way it leaves
      // isolation, or the tabs would keep offering to trace a lead that no longer needs it.
      recoveryStage: 'recovered',
      recoveredAt: new Date(),
      recoveredEmail: true,
    });
    await addActivity(
      l.id,
      'status_change',
      `Status: isolated → ${back} (insured email found)`,
      { changes: [{ field: 'Status', from: 'isolated', to: back }] },
      createdBy ? `isolate · ${createdBy}` : 'isolate (system)',
    );
  }

  return out;
}
