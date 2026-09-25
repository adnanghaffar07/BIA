import { sql } from '@/lib/neon';
import { wallClockIso } from '@/lib/wallClock';

/**
 * The run log (Frank, 24 Sep 2026 · fix 20).
 *
 * "Skip-trace runs and grading changes logged in real time, with cohort, account count and
 *  process."
 *
 * ── Why a run needs its own row ─────────────────────────────────────────────
 * Per-account history is already complete: an Activity row for every lead a blast touches,
 * a GradeChange row for every grade that moved. What none of it records is the run.
 *
 * A blast over a pool of 47 that recovers 3, and a blast over a pool of 3 that recovers 3,
 * leave the same three Activity rows. They mean opposite things, and no amount of grouping
 * by timestamp can separate them, because the 44 that returned nothing were never written.
 * A run that finds nothing at all leaves no trace by that method at all — so "we traced
 * that week and got nothing" reads identically to "nobody has ever traced it".
 *
 * ── Written at the start, not the end ───────────────────────────────────────
 * "In real time" is the part that decides the design. The row exists from the moment the
 * run begins, saying `running`. A run still going, and a run that died half way through a
 * vendor call, are both visible — which are exactly the moments somebody asks what is
 * happening. A log written only on success goes quiet precisely when it is needed.
 */

export type ProcessName =
  | 'tracerfy_blast' | 'batchdata_blast' | 'regrade' | 'send_list_build' | 'enrichment' | 'pull';

export const PROCESS_RUN_LABEL: Record<ProcessName, string> = {
  tracerfy_blast: 'Tracerfy blast',
  batchdata_blast: 'BatchData blast',
  regrade: 'Re-grade pass',
  send_list_build: 'Send list build',
  enrichment: 'Enrichment',
  pull: 'Weekly pull',
};

export type RunOutcome = 'running' | 'ok' | 'failed' | 'aborted';

export type ProcessRunRow = {
  id: string;
  process: ProcessName;
  processLabel: string;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: RunOutcome;
  cohortFrom: string | null;
  cohortTo: string | null;
  considered: number | null;
  touched: number | null;
  changed: number | null;
  byCohort: Record<string, unknown> | null;
  runBy: string | null;
  dryRun: boolean;
  detail: Record<string, unknown> | null;
  error: string | null;
};

/**
 * Open a run. Returns the id the caller closes it with.
 *
 * Never throws. A blast that cannot write its log row must still run — the log is there to
 * describe the work, not to gate it. A failure here returns null and the caller carries on;
 * every finish/fail below is a no-op on a null id.
 */
export async function startRun(input: {
  process: ProcessName;
  cohortFrom?: string | null;
  cohortTo?: string | null;
  considered?: number | null;
  runBy?: string | null;
  dryRun?: boolean;
  detail?: Record<string, unknown> | null;
}): Promise<string | null> {
  try {
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO "ProcessRun"
        ("id","process","startedAt","outcome","cohortFrom","cohortTo","considered",
         "runBy","dryRun","detail","createdAt","updatedAt")
      VALUES
        (${id}, ${input.process}, NOW(), 'running',
         ${input.cohortFrom ?? null}, ${input.cohortTo ?? null},
         ${input.considered ?? null}, ${input.runBy ?? null},
         ${Boolean(input.dryRun)},
         ${input.detail ? JSON.stringify(input.detail) : null}::jsonb,
         NOW(), NOW())`;
    return id;
  } catch {
    return null;
  }
}

/** Close a run with its counts. Silent on a null id, so callers need no branch. */
export async function finishRun(id: string | null, input: {
  outcome?: RunOutcome;
  touched?: number | null;
  changed?: number | null;
  byCohort?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  if (!id) return;
  try {
    await sql`
      UPDATE "ProcessRun"
         SET "finishedAt" = NOW(),
             "outcome"    = ${input.outcome ?? 'ok'},
             "touched"    = ${input.touched ?? null},
             "changed"    = ${input.changed ?? null},
             "byCohort"   = ${input.byCohort ? JSON.stringify(input.byCohort) : null}::jsonb,
             -- Merged, not replaced. The start already stored what the run was pointed at,
             -- and overwriting it here would lose the intent of any run that ends early.
             "detail"     = COALESCE("detail", '{}'::jsonb)
                            || COALESCE(${input.detail ? JSON.stringify(input.detail) : null}::jsonb, '{}'::jsonb),
             "error"      = ${input.error ?? null},
             "updatedAt"  = NOW()
       WHERE "id" = ${id}`;
  } catch {
    /* A log that fails to close must not take the run down with it. */
  }
}

/**
 * Close a run that threw.
 *
 * Separate from finishRun so the failing path cannot accidentally report 'ok' by leaving
 * the outcome off — the default is success, and a catch block is the one place that must
 * never take a default.
 */
export async function failRun(id: string | null, err: unknown, partial: {
  touched?: number | null; changed?: number | null;
} = {}): Promise<void> {
  await finishRun(id, {
    outcome: 'failed',
    touched: partial.touched ?? null,
    changed: partial.changed ?? null,
    error: err instanceof Error ? err.message : String(err),
  });
}

export async function getProcessRuns(params: {
  process?: ProcessName; from?: string; to?: string; limit?: number;
} = {}): Promise<ProcessRunRow[]> {
  const rows = await sql`
    SELECT * FROM "ProcessRun"
     WHERE (${params.process ?? null}::text IS NULL OR "process" = ${params.process ?? null})
       AND (${params.from ?? null}::text IS NULL OR "cohortTo"   IS NULL OR "cohortTo"   >= ${params.from ?? null})
       AND (${params.to ?? null}::text   IS NULL OR "cohortFrom" IS NULL OR "cohortFrom" <= ${params.to ?? null})
     ORDER BY "startedAt" DESC
     LIMIT ${Math.min(Number(params.limit) || 200, 1000)}` as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    process: r.process as ProcessName,
    processLabel: PROCESS_RUN_LABEL[r.process as ProcessName] ?? String(r.process),
    // wallClockIso, not toISOString: these are `timestamp without time zone`, and the
    // driver hands them back parsed in the server's zone — seven hours out here. See
    // src/lib/wallClock.ts.
    startedAt: wallClockIso(r.startedAt),
    finishedAt: wallClockIso(r.finishedAt),
    outcome: r.outcome as RunOutcome,
    cohortFrom: r.cohortFrom ?? null,
    cohortTo: r.cohortTo ?? null,
    considered: r.considered == null ? null : Number(r.considered),
    touched: r.touched == null ? null : Number(r.touched),
    changed: r.changed == null ? null : Number(r.changed),
    byCohort: r.byCohort ?? null,
    runBy: r.runBy ?? null,
    dryRun: Boolean(r.dryRun),
    detail: r.detail ?? null,
    error: r.error ?? null,
  }));
}

/**
 * Runs that never closed.
 *
 * A row still saying `running` an hour after it started did not finish — the process
 * crashed, the deploy cycled, or the request timed out. Worth surfacing rather than leaving
 * on the tab looking busy: a permanently "running" blast is the thing that makes somebody
 * wait instead of re-running it.
 */
export async function stalledRuns(olderThanMinutes = 60): Promise<ProcessRunRow[]> {
  /**
   * Compared in SQL, where the timestamp never leaves Postgres.
   *
   * The first version filtered in JavaScript against Date.now(). "startedAt" is
   * `timestamp without time zone`, so the driver returns it parsed in the server's zone —
   * seven hours ahead of the real instant here. Every run therefore looked as though it had
   * started in the future, nothing was ever older than the cutoff, and this function
   * silently returned nothing at all. A crashed run would have stayed invisible for seven
   * hours past the point anybody wanted to know about it.
   *
   * It passed nothing and broke nothing, which is why it took a test asserting the
   * opposite direction to find it.
   */
  const rows = await sql`
    SELECT "id" FROM "ProcessRun"
     WHERE "outcome" = 'running'
       AND "startedAt" < NOW()::timestamp - (${Number(olderThanMinutes) || 0} * INTERVAL '1 minute')` as Array<{ id: string }>;
  if (!rows.length) return [];
  const ids = new Set(rows.map((r) => String(r.id)));
  return (await getProcessRuns({ limit: 1000 })).filter((r) => ids.has(r.id));
}
