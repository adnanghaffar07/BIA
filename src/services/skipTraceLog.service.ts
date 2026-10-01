import { sql } from '@/lib/neon';

/**
 * A record of every skip trace, written by the vendor functions themselves.
 *
 * ── Why it lives inside the vendor call and not at the call sites ───────────
 * There are several places a trace can be started from — the card, the blast, the recovery
 * pipeline — and a logger wired in at each of them is a list somebody has to remember to
 * add to. This project has been bitten by that shape repeatedly: a hand-maintained column
 * list, a hand-maintained push, a hand-maintained lookup. The failure is always the same and
 * always silent. Logging from inside runTracerfy and runBatchData means a new caller is
 * covered the day it is written, including one written by somebody who has not read this.
 *
 * ── Logging must never break a trace ────────────────────────────────────────
 * A trace that succeeded and failed to log is worth strictly more than a trace that was
 * abandoned because the log was down. Every write here swallows its own errors.
 */

export type TraceOutcome = 'hit' | 'miss' | 'error';

export interface TraceLogEntry {
  leadId: string;
  propertyId?: string | null;
  provider: 'tracerfy' | 'batchdata';
  tier?: string | null;
  runId?: string | null;
  /** Null means no name was sent — which is itself the finding, not a gap in the record. */
  sentFirstName?: string | null;
  sentLastName?: string | null;
  sentAddress?: string | null;
  sentCity?: string | null;
  sentState?: string | null;
  sentZip?: string | null;
  requests?: number;
  outcome: TraceOutcome;
  returnedName?: string | null;
  personCount?: number | null;
  phoneCount?: number | null;
  emailCount?: number | null;
  credits?: number | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  createdBy?: string | null;
}

export async function logTrace(e: TraceLogEntry): Promise<void> {
  try {
    await sql`
      INSERT INTO "SkipTraceLog" (
        "id","leadId","propertyId","provider","tier","runId",
        "sentFirstName","sentLastName","sentAddress","sentCity","sentState","sentZip",
        "requests","outcome","returnedName","personCount","phoneCount","emailCount",
        "credits","errorMessage","durationMs","createdBy"
      ) VALUES (
        ${crypto.randomUUID()}, ${e.leadId}, ${e.propertyId ?? null}, ${e.provider},
        ${e.tier ?? null}, ${e.runId ?? null},
        ${e.sentFirstName ?? null}, ${e.sentLastName ?? null}, ${e.sentAddress ?? null},
        ${e.sentCity ?? null}, ${e.sentState ?? null}, ${e.sentZip ?? null},
        ${e.requests ?? 1}, ${e.outcome}, ${e.returnedName ?? null},
        ${e.personCount ?? null}, ${e.phoneCount ?? null}, ${e.emailCount ?? null},
        ${e.credits ?? null}, ${e.errorMessage ?? null}, ${e.durationMs ?? null},
        ${e.createdBy ?? null}
      )`;
  } catch (err) {
    // Deliberately swallowed — see the header. Surfaced to the server log so a logging
    // outage is visible to us without ever reaching the person running the trace.
    console.error('skip-trace log write failed:', (err as Error)?.message);
  }
}

export interface RunSummary {
  runId: string | null;
  provider: string;
  traces: number;
  hits: number;
  misses: number;
  errors: number;
  credits: number;
  /** Traces whose request carried no insured name — address-only lookups. */
  addressOnly: number;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * What a run actually did — the same-day check.
 *
 * A blast that traced nothing shows here as a run with zero traces, or as no run at all for
 * a cohort that was supposed to have one. Both are visible; neither was before.
 */
export async function traceRuns(limit = 25): Promise<RunSummary[]> {
  const rows = await sql`
    SELECT "runId", "provider",
           count(*)::int AS traces,
           count(CASE WHEN "outcome" = 'hit' THEN 1 END)::int AS hits,
           count(CASE WHEN "outcome" = 'miss' THEN 1 END)::int AS misses,
           count(CASE WHEN "outcome" = 'error' THEN 1 END)::int AS errors,
           COALESCE(sum("credits"), 0)::float AS credits,
           count(CASE WHEN "sentFirstName" IS NULL AND "sentLastName" IS NULL THEN 1 END)::int AS address_only,
           min("createdAt") AS started_at,
           max("createdAt") AS ended_at
      FROM "SkipTraceLog"
     GROUP BY "runId", "provider"
     ORDER BY max("createdAt") DESC
     LIMIT ${limit}` as Array<Record<string, any>>;
  return rows.map((r) => ({
    runId: r.runId ?? null,
    provider: r.provider,
    traces: r.traces,
    hits: r.hits,
    misses: r.misses,
    errors: r.errors,
    credits: r.credits,
    addressOnly: r.address_only,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  }));
}

/** Every trace ever run against one lead, newest first — the card's own history. */
export async function tracesForLead(leadId: string, limit = 50) {
  return await sql`
    SELECT * FROM "SkipTraceLog"
     WHERE "leadId" = ${leadId}
     ORDER BY "createdAt" DESC
     LIMIT ${limit}` as Array<Record<string, any>>;
}

/**
 * Did the cohort actually get traced, and with what sent to the vendor?
 *
 * This is the question that could not be answered on 1 Oct: the C1 blast "did not run on all
 * accounts and nothing flagged it". With a log, a cohort's untraced cards are a query.
 */
export async function coverageByCohort(cohort: string, grade = 'A') {
  const [row] = await sql`
    SELECT
           -- DISTINCT, because the join fans out one card into one row per trace. Counting
           -- rows reported 63 cards in a 62-card cohort the first time this ran, and a
           -- coverage figure whose denominator moves with the number of traces is worse
           -- than no figure.
           count(DISTINCT l."id")::int AS cards,
           count(DISTINCT t."leadId")::int AS traced,
           count(DISTINCT CASE WHEN t."sentFirstName" IS NOT NULL THEN t."leadId" END)::int AS traced_with_name
      FROM "Lead" l
      LEFT JOIN "SkipTraceLog" t ON t."leadId" = l."id"
     WHERE l."cohort"::text = ${cohort} AND l."grade" = ${grade}` as Array<Record<string, any>>;
  return {
    cards: row?.cards ?? 0,
    traced: row?.traced ?? 0,
    tracedWithName: row?.traced_with_name ?? 0,
    untraced: (row?.cards ?? 0) - (row?.traced ?? 0),
  };
}
