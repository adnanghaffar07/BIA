import { sql } from '@/lib/neon';
import { wallClockIso } from '@/lib/wallClock';

/**
 * Recapture — an account returning to play (Frank, 24 Sep 2026 · fixes 17, 19, 22).
 *
 * ── The three fixes are one event ───────────────────────────────────────────
 * Frank listed them separately, but they are the same moment seen from three sides: the
 * account's own record (17), the cohort it lands in (19), and the log somebody reads (22).
 * Written as three features they would drift; written once they cannot.
 *
 * ── Why the holding pool is derived and not stored ──────────────────────────
 * A cohort is frozen the moment its send list is built, which Lead."sendListBuiltAt"
 * already records. A lead sitting in a frozen cohort without that stamp did not exist in
 * the cohort when it froze — that IS the holding pool, and no second column can contradict
 * it. The one thing the event log does store is whether the cohort was frozen at the time,
 * because the send list can be rebuilt and a held account must not quietly stop reading as
 * held.
 *
 * ── What "recaptured" is allowed to overwrite ───────────────────────────────
 * Nothing. Fix 17 asks for a status, but Frank's own instruction of 23 Sep was that pulling
 * a lead for skip trace must never overwrite its 'rated' status — and 13 of the 34 accounts
 * recaptured so far are sitting at 'rated'. Writing 'recaptured' into the status column
 * would destroy exactly the fact that instruction exists to protect. So recapture is its own
 * state, carried beside the status and displayed with it, and the complaint fix 17 actually
 * makes — that a returned account reads as New and looks unworked — is answered by
 * recaptureLabel() below, which never returns New for an account that came back.
 */

/** The processes that can return an account. Named, because "it came back" is uncheckable. */
export type RecaptureProcess = 'tracerfy' | 'batchdata' | 'grade_change' | 'manual';

export const PROCESS_LABEL: Record<RecaptureProcess, string> = {
  tracerfy: 'Tracerfy skip trace',
  batchdata: 'BatchData skip trace',
  grade_change: 'Re-grade',
  manual: 'Entered by hand',
};

export type RecaptureRow = {
  id: string;
  leadId: string;
  propertyId: string | null;
  cohort: string | null;
  recapturedAt: string | null;
  process: RecaptureProcess;
  processLabel: string;
  priorStatus: string | null;
  priorGrade: string | null;
  newGrade: string | null;
  heldFromCohort: boolean;
  rubenNotifiedAt: string | null;
  notifiedBy: string | null;
  note: string | null;
  /** Joined for display only — never for the facts above, which are frozen at event time. */
  ownerName: string | null;
  address: string | null;
};

/**
 * Every cohort whose send list has been built.
 *
 * Derived rather than configured: a list of "frozen cohorts" kept by hand is a list that is
 * wrong the first time somebody builds a list and forgets to update it.
 */
export async function frozenCohorts(): Promise<Set<string>> {
  const rows = await sql`
    SELECT DISTINCT "cohort" FROM "Lead"
     WHERE "sendListBuiltAt" IS NOT NULL AND "cohort" IS NOT NULL` as Array<{ cohort: string }>;
  return new Set(rows.map((r) => String(r.cohort)));
}

/**
 * Record that an account came back.
 *
 * Idempotent on (lead, process) — a blast rerun over the same lead logs once. The account
 * came back once; a second row would inflate every count on the tab and the day's report.
 *
 * Returns whether the row was held from a frozen cohort, so the caller can say so in the
 * activity trail rather than the reader having to go and look.
 */
export async function logRecapture(input: {
  leadId: string;
  propertyId?: string | null;
  cohort?: string | null;
  process: RecaptureProcess;
  priorStatus?: string | null;
  priorGrade?: string | null;
  newGrade?: string | null;
  note?: string | null;
}): Promise<{ logged: boolean; held: boolean }> {
  const cohort = input.cohort ?? null;

  /**
   * Frozen AND this lead was not in the freeze. Both halves matter: a lead that was on the
   * send list and later re-traced has not joined anything late, and must not be held.
   */
  const [state] = await sql`
    SELECT ${cohort}::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM "Lead" WHERE "cohort" = ${cohort} AND "sendListBuiltAt" IS NOT NULL
           ) AS frozen,
           (SELECT "sendListBuiltAt" IS NOT NULL FROM "Lead" WHERE "id" = ${input.leadId}) AS on_list` as Array<{ frozen: boolean; on_list: boolean | null }>;
  const held = Boolean(state?.frozen) && !state?.on_list;

  const rows = await sql`
    INSERT INTO "RecaptureLog"
      ("id","leadId","propertyId","cohort","recapturedAt","process",
       "priorStatus","priorGrade","newGrade","heldFromCohort","note","createdAt")
    VALUES
      (${crypto.randomUUID()}, ${input.leadId}, ${input.propertyId ?? null}, ${cohort},
       NOW(), ${input.process},
       ${input.priorStatus ?? null}, ${input.priorGrade ?? null}, ${input.newGrade ?? null},
       ${held}, ${input.note ?? null}, NOW())
    ON CONFLICT ("leadId","process") DO NOTHING
    RETURNING "id"` as Array<{ id: string }>;

  return { logged: rows.length > 0, held };
}

/** The log, newest first. Fix 22's tab reads this and nothing else. */
export async function getRecaptureLog(params: {
  from?: string; to?: string; heldOnly?: boolean; unnotifiedOnly?: boolean; limit?: number;
} = {}): Promise<RecaptureRow[]> {
  const rows = await sql`
    SELECT r.*, l."owner1FirstName", l."owner1LastName",
           l."addressStreet", l."addressCity", l."addressZip"
      FROM "RecaptureLog" r
      LEFT JOIN "Lead" l ON l."id" = r."leadId"
     WHERE (${params.from ?? null}::text IS NULL OR r."cohort" >= ${params.from ?? null})
       AND (${params.to ?? null}::text   IS NULL OR r."cohort" <= ${params.to ?? null})
       AND (${params.heldOnly ?? false}::boolean = FALSE OR r."heldFromCohort" = TRUE)
       AND (${params.unnotifiedOnly ?? false}::boolean = FALSE OR r."rubenNotifiedAt" IS NULL)
     ORDER BY r."recapturedAt" DESC
     LIMIT ${Math.min(Number(params.limit) || 500, 2000)}` as Array<Record<string, any>>;

  return rows.map((r) => ({
    id: String(r.id),
    leadId: String(r.leadId),
    propertyId: r.propertyId ?? null,
    cohort: r.cohort ?? null,
    // See src/lib/wallClock.ts — these columns carry no zone, and toISOString() on the
    // driver's Date moves them by the server's offset.
    recapturedAt: wallClockIso(r.recapturedAt),
    process: r.process as RecaptureProcess,
    processLabel: PROCESS_LABEL[r.process as RecaptureProcess] ?? String(r.process),
    priorStatus: r.priorStatus ?? null,
    priorGrade: r.priorGrade ?? null,
    newGrade: r.newGrade ?? null,
    heldFromCohort: Boolean(r.heldFromCohort),
    rubenNotifiedAt: wallClockIso(r.rubenNotifiedAt),
    notifiedBy: r.notifiedBy ?? null,
    note: r.note ?? null,
    ownerName: [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ') || null,
    address: [r.addressStreet, r.addressCity, r.addressZip].filter(Boolean).join(', ') || null,
  }));
}

/** One line per cohort: how many came back, and how many of those the freeze held out. */
export async function holdingPoolSummary(params: { from?: string; to?: string } = {}): Promise<Array<{
  cohort: string; frozen: boolean; recaptured: number; held: number; unnotified: number;
}>> {
  const frozen = await frozenCohorts();
  const rows = await sql`
    SELECT "cohort",
           COUNT(*)::int AS recaptured,
           COUNT(*) FILTER (WHERE "heldFromCohort")::int AS held,
           COUNT(*) FILTER (WHERE "heldFromCohort" AND "rubenNotifiedAt" IS NULL)::int AS unnotified
      FROM "RecaptureLog"
     WHERE "cohort" IS NOT NULL
       AND (${params.from ?? null}::text IS NULL OR "cohort" >= ${params.from ?? null})
       AND (${params.to ?? null}::text   IS NULL OR "cohort" <= ${params.to ?? null})
     GROUP BY "cohort" ORDER BY "cohort"` as Array<Record<string, any>>;

  return rows.map((r) => ({
    cohort: String(r.cohort),
    frozen: frozen.has(String(r.cohort)),
    recaptured: Number(r.recaptured),
    held: Number(r.held),
    unnotified: Number(r.unnotified),
  }));
}

/** Fix 21's half: mark that Ruben has been told about these events. */
export async function markRubenNotified(ids: string[], by: string): Promise<number> {
  if (!ids.length) return 0;
  const rows = await sql`
    UPDATE "RecaptureLog"
       SET "rubenNotifiedAt" = NOW(), "notifiedBy" = ${by}
     WHERE "id" = ANY(${ids}::text[]) AND "rubenNotifiedAt" IS NULL
    RETURNING "id"` as Array<{ id: string }>;
  return rows.length;
}

/**
 * What the account should READ as (fix 17).
 *
 * Frank's complaint is that a recaptured account shows New and looks as though nobody ever
 * touched it. This never returns New for an account that came back — but it also never
 * throws away a status that was earned. An account that was rated before it went quiet
 * reads "Rated · Recaptured", because both are true and losing either one is what caused
 * the original problem.
 */
export function recaptureLabel(lead: {
  status?: string | null;
  recoveryStage?: string | null;
  recoveredAt?: unknown;
  recoveredBy?: string | null;
}, statusLabel: string): string {
  if (lead.recoveryStage !== 'recovered' && !lead.recoveredAt) return statusLabel;
  const base = !lead.status || lead.status === 'new' ? '' : `${statusLabel} · `;
  return `${base}Recaptured`;
}
