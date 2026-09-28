import { sql } from '@/lib/neon';
import { insuredEmails } from './recipients.service';

/**
 * The skip-trace blast queue — putting leads in it, and reading it back.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The blast runs off the Leads page's filter set. That works while the population you want
 * is expressible as filters, and the Grade-B roof pull is not: it is "Grade B, roof year
 * unknown, house 21–76 years old", and home age is not a Leads filter. Handing the blast a
 * grade and a date range would run it over 3,482 leads when 2,681 were on screen, and the
 * only sign would be the credit bill.
 *
 * So the selection is recorded against the leads. What somebody chose is a fact; a filter
 * that reproduces it is a hope.
 *
 * ── Queuing isolates, and that is the point ─────────────────────────────────
 * A lead pulled for tracing is not part of any send list until it comes back with an
 * address. Leaving it in the population means a cohort forecasts against leads that cannot
 * receive anything, which is the failure isolate.service was written for — the dashboard
 * reporting 48 rated for a week holding 61.
 *
 * Isolation here is EXPLICIT and narrow: these specific leads, because a person pressed a
 * button, recorded with who and why. That is deliberately different from
 * isolateUnreachable(), which is a standing rule that sweeps Grade A leads with no insured
 * email. Both write isolatedAt; only one of them is a judgement somebody made.
 *
 * ── A and B are separate queues ─────────────────────────────────────────────
 * Frank, 28 Sep: Grade B email outreach matters *because* there is no band price, which
 * makes a Grade B trace speculative where a Grade A trace is chasing an address for an
 * account already priced and ready to send. Different economics, different decision to
 * spend credits, so they never share a run.
 */

export type BlastGrade = 'A' | 'B';

export type QueueResult = {
  /** Asked for. */
  requested: number;
  /** Newly queued by this call. */
  queued: number;
  /** Already in a queue, left exactly as they were. */
  alreadyQueued: number;
  /** Newly isolated as part of queuing. */
  isolated: number;
  /** Already isolated — their original reason is preserved, not overwritten. */
  alreadyIsolated: number;
  /** Already traced by a previous blast, so queuing them would re-spend credits. */
  alreadyTraced: number;
};

/**
 * Put leads in a blast queue and isolate them.
 *
 * Idempotent on purpose. Somebody re-running a pull after adjusting a filter is the normal
 * case, and a second press must not double-isolate, overwrite the reason a lead was
 * isolated for the first time, or re-queue something a blast has already paid for.
 */
export async function queueForBlast(opts: {
  propertyIds: string[];
  grade: BlastGrade;
  actor: string | null;
  reason: string;
}): Promise<QueueResult> {
  const { propertyIds, grade, actor, reason } = opts;
  const ids = [...new Set(propertyIds.map((p) => String(p).trim()).filter(Boolean))];

  const out: QueueResult = {
    requested: ids.length,
    queued: 0, alreadyQueued: 0, isolated: 0, alreadyIsolated: 0, alreadyTraced: 0,
  };
  if (!ids.length) return out;

  const rows = await sql`
    SELECT "propertyId", "status", "blastQueuedAt", "blastQueueGrade",
           "isolatedAt", "deepSkipTracedAt", "blastSkipTracedAt"
      FROM "Lead" WHERE "propertyId" = ANY(${ids})` as Array<Record<string, unknown>>;

  const toQueue: string[] = [];
  for (const r of rows) {
    if (r.blastQueuedAt != null) { out.alreadyQueued++; continue; }
    /**
     * A lead a blast has already traced is not queued again.
     *
     * Tracerfy bills per hit, so re-queuing 2,681 already-traced leads is a real bill for
     * answers we hold. The blast itself also skips them, but by then the queue has already
     * told somebody it was going to do 2,681 things.
     */
    if (r.blastSkipTracedAt != null || r.deepSkipTracedAt != null) { out.alreadyTraced++; continue; }
    toQueue.push(String(r.propertyId));
    if (r.isolatedAt != null) out.alreadyIsolated++;
  }

  if (!toQueue.length) return out;

  /**
   * One statement, so a lead cannot end up queued but not isolated.
   *
   * isolatedAt / isolatedFromStatus / isolatedReason are COALESCEd: a lead already isolated
   * for another reason keeps that reason and that timestamp. Overwriting them would erase
   * why it was parked in the first place, and isolatedFromStatus is the only record of what
   * a lead's status was before — 46 leads are recoverable solely from it.
   *
   * `status` is deliberately untouched. Frank, 23 Sep: "pulling a lead for skip trace never
   * overwrites its 'rated' status." Rated and unreachable are two facts about one lead, not
   * alternatives.
   */
  const updated = await sql`
    UPDATE "Lead"
       SET "blastQueuedAt"      = NOW(),
           "blastQueuedBy"      = ${actor},
           "blastQueueGrade"    = ${grade},
           "blastQueueReason"   = ${reason},
           /**
            * The pipeline stage, so a Grade B lead is recorded exactly as a Grade A one is.
            *
            * Without this, queuing set isolatedAt and nothing else — the lead was isolated,
            * kept out of send lists, and invisible in the Blast Skip Traces stages, because
            * those count recoveryStage. It sat in a queue with no record of where it was in
            * the work, which is the one thing the pipeline exists to say.
            *
            * COALESCE so a lead already partway through (Tracerfy tried, BatchData next)
            * is not dragged back to the start by being queued again.
            */
           "recoveryStage"      = COALESCE("recoveryStage", 'isolated'),
           "isolatedAt"         = COALESCE("isolatedAt", NOW()),
           "isolatedFromStatus" = COALESCE("isolatedFromStatus", "status"),
           "isolatedReason"     = COALESCE("isolatedReason", ${`queued for the Grade ${grade} skip-trace blast`}),
           "updatedAt"          = NOW()
     WHERE "propertyId" = ANY(${toQueue})
    RETURNING "propertyId"` as Array<{ propertyId: string }>;

  out.queued = updated.length;
  out.isolated = updated.length - out.alreadyIsolated;
  return out;
}

/** Take leads back out. The button has to be undoable or nobody will press it. */
export async function dequeueFromBlast(propertyIds: string[]): Promise<number> {
  const ids = [...new Set(propertyIds.map((p) => String(p).trim()).filter(Boolean))];
  if (!ids.length) return 0;

  /**
   * ── Leaving the queue does not make a lead reachable ────────────────────
   *
   * The first version lifted isolation wherever the reason string said the queue had caused
   * it. That is the wrong test. Isolation means "no insured email" — a lead queued, traced,
   * and returned with a phone but no address is STILL unmailable, and clearing its isolation
   * would drop it back into a send list it cannot be mailed from. Which is the exact failure
   * isolate.service was written to stop.
   *
   * So the question asked here is not "who put this flag on" but "does it still apply".
   * Reachability decides, and the reason string only decides the WORDING left behind: a lead
   * that stays isolated after leaving the queue must not go on claiming it is waiting in one.
   *
   * insuredEmails() reads the trace payload's per-person attribution rather than the email
   * columns, because an address belonging to the co-insured sits in those columns too and
   * would read as the insured being reachable.
   */
  const leads = await sql`
    SELECT "propertyId","status","isolatedAt","isolatedReason","recoveryStage",
           "recoveryTracerfyAt","recoveryBatchDataAt","blastQueuedAt",
           "email1","email2","owner2Email","emailsAll","skipTraceData",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName"
      FROM "Lead"
     WHERE "propertyId" = ANY(${ids}) AND "blastQueuedAt" IS NOT NULL` as Array<Record<string, unknown>>;

  let removed = 0;
  for (const l of leads) {
    const queuedIsolation = String(l.isolatedReason ?? '').startsWith('queued for the Grade');
    const reachable = insuredEmails(l).length > 0;
    /** Lift only when the queue put it there AND the lead can now actually be emailed. */
    const lift = queuedIsolation && reachable;
    /**
     * Unwind the pipeline stage only if the queue put the lead there and no vendor has run.
     * A lead Tracerfy has already been billed for keeps its place — the money is spent and
     * the result is real whether or not anybody still wants it in a queue.
     */
    const unwindStage = queuedIsolation
      && l.recoveryStage === 'isolated'
      && l.recoveryTracerfyAt == null
      && l.recoveryBatchDataAt == null;

    await sql`
      UPDATE "Lead"
         SET "blastQueuedAt"    = NULL,
             "blastQueuedBy"    = NULL,
             "blastQueueGrade"  = NULL,
             "blastQueueReason" = NULL,
             "isolatedAt"         = ${lift ? null : (l.isolatedAt as Date | null)},
             "isolatedFromStatus" = ${lift ? null : (l.isolatedFromStatus as string | null) ?? null},
             "isolatedReason"     = ${lift
                 ? null
                 : (queuedIsolation
                     // Still unmailable, but no longer in a queue. Say what is actually true.
                     ? 'no insured email — removed from the blast queue, still unreachable'
                     : (l.isolatedReason as string | null) ?? null)},
             "recoveryStage"      = ${unwindStage ? null : (l.recoveryStage as string | null) ?? null},
             "updatedAt" = NOW()
       WHERE "propertyId" = ${String(l.propertyId)}`;
    removed++;
  }
  const rows = { length: removed } as { length: number };
  return rows.length;
}

export type QueueSummary = {
  grade: BlastGrade;
  waiting: number;
  traced: number;
  queuedBy: string[];
  oldest: string | null;
};

/** What each queue is holding — one row per grade, for the blast screen's header. */
export async function blastQueueSummary(): Promise<QueueSummary[]> {
  const rows = await sql`
    SELECT "blastQueueGrade" AS grade,
           COUNT(*) FILTER (WHERE "blastSkipTracedAt" IS NULL)::int AS waiting,
           COUNT(*) FILTER (WHERE "blastSkipTracedAt" IS NOT NULL)::int AS traced,
           MIN("blastQueuedAt") AS oldest,
           ARRAY_AGG(DISTINCT "blastQueuedBy") FILTER (WHERE "blastQueuedBy" IS NOT NULL) AS by
      FROM "Lead"
     WHERE "blastQueuedAt" IS NOT NULL
     GROUP BY 1 ORDER BY 1` as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    grade: (r.grade === 'B' ? 'B' : 'A') as BlastGrade,
    waiting: Number(r.waiting ?? 0),
    traced: Number(r.traced ?? 0),
    queuedBy: (r.by as string[] | null) ?? [],
    // timestamp without time zone — read the local parts, never toISOString().
    oldest: r.oldest instanceof Date
      ? `${r.oldest.getFullYear()}-${String(r.oldest.getMonth() + 1).padStart(2, '0')}-${String(r.oldest.getDate()).padStart(2, '0')}`
      : null,
  }));
}
