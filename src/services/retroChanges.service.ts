import { sql } from '@/lib/neon';
import { wallClockIso } from '@/lib/wallClock';
import { markRubenNotified } from './recapture.service';

/**
 * Retroactive changes to worked accounts (Frank, 24 Sep 2026 · fix 21).
 *
 * "No retroactive change to a worked account without notifying Ruben — daily report of what
 *  changed."
 *
 * ── The situation it describes ──────────────────────────────────────────────
 * Ruben rates an account, calls it, quotes it. Afterwards something the machine does changes
 * it underneath him: a re-grade drops it out of his queue, a trace rewrites its status, an
 * enrichment pass flips its eligibility. He finds out by opening a card he already worked
 * and finding it different, with nothing saying when or why.
 *
 * On 22 Sep one re-grading pass changed 28 already-worked accounts in a single day. Nothing
 * told anybody.
 *
 * ── What counts, and what deliberately does not ─────────────────────────────
 * A producer changing an account he is working is not a retroactive change — it is the work.
 * Only changes whose SOURCE is the system qualify. Counting producer edits would bury the
 * twenty-eight that matter under four hundred that do not, and a report nobody can read is
 * the same as no report.
 *
 * ── Derived, never copied ───────────────────────────────────────────────────
 * The changes live in GradeChange and RecaptureLog. This reads them. The one thing it
 * stores is whether Ruben was told, because nothing else records that and it cannot be
 * worked out from anything that does.
 */

/**
 * What makes an account "worked" lives in the "WorkedLead" VIEW (migration 040), not here.
 *
 * Two queries below need the condition and the driver is a tagged template with no way to
 * splice a fragment in. The alternatives were to write it out twice — which drifts the
 * moment one copy is edited — or to build it by concatenation, which is how injection gets
 * written even when today's inputs are constant. A view is defined once and checked by the
 * database.
 */

export type RetroChange = {
  kind: 'grade' | 'recapture';
  leadId: string;
  propertyId: string | null;
  owner: string | null;
  address: string | null;
  cohort: string | null;
  at: string | null;
  /** Plain English, because this goes to a person who is not reading the schema. */
  what: string;
  by: string | null;
  /** What the account was when it was worked — the thing that changed underneath him. */
  workedState: string | null;
};

export type RetroDay = {
  day: string;
  changes: RetroChange[];
  accountCount: number;
  notice: { id: string; sentAt: string | null; sentTo: string | null; method: string | null } | null;
};

/**
 * Every retroactive change on one day.
 *
 * `day` is a plain YYYY-MM-DD compared inside Postgres. These columns are
 * `timestamp without time zone`, so a range built in JavaScript would be shifted by the
 * server's offset — seven hours here, which would silently put a third of every day in the
 * wrong bucket. See src/lib/wallClock.ts.
 */
export async function getRetroChanges(day: string): Promise<RetroDay> {
  const grades = await sql`
    SELECT g."leadId", g."fromGrade", g."toGrade", g."reason", g."changedBy", g."changedAt",
           l."propertyId", l."owner1FirstName", l."owner1LastName",
           l."addressStreet", l."addressCity", l."cohort", l."status",
           l."travelersPremium", l."plymouthPremium"
      FROM "GradeChange" g
      JOIN "Lead" l ON l."id" = g."leadId"
     WHERE g."changedAt"::date = ${day}::date
       -- System only. A producer changing the account he is working is the work, not a
       -- change made to him behind his back.
       AND g."source" = 'system'
       AND EXISTS (SELECT 1 FROM "WorkedLead" w WHERE w."id" = l."id")
     ORDER BY g."changedAt" DESC` as Array<Record<string, any>>;

  const recaptures = await sql`
    SELECT r."leadId", r."process", r."priorGrade", r."newGrade", r."recapturedAt",
           r."heldFromCohort", r."cohort" AS "logCohort",
           l."propertyId", l."owner1FirstName", l."owner1LastName",
           l."addressStreet", l."addressCity", l."status",
           l."travelersPremium", l."plymouthPremium"
      FROM "RecaptureLog" r
      JOIN "Lead" l ON l."id" = r."leadId"
     WHERE r."recapturedAt"::date = ${day}::date
       AND EXISTS (SELECT 1 FROM "WorkedLead" w WHERE w."id" = l."id")
     ORDER BY r."recapturedAt" DESC` as Array<Record<string, any>>;

  const name = (r: any) => [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ') || null;
  const addr = (r: any) => [r.addressStreet, r.addressCity].filter(Boolean).join(', ') || null;
  /** What a person would say the account was, so the line reads without a lookup. */
  const state = (r: any) => {
    const bits: string[] = [];
    if (r.travelersPremium != null || r.plymouthPremium != null) bits.push('had a premium entered');
    if (r.status && r.status !== 'new') bits.push(`status ${String(r.status).replace(/_/g, ' ')}`);
    return bits.join(', ') || null;
  };

  const changes: RetroChange[] = [
    ...grades.map((r) => ({
      kind: 'grade' as const,
      leadId: String(r.leadId),
      propertyId: r.propertyId ?? null,
      owner: name(r),
      address: addr(r),
      cohort: r.cohort ?? null,
      at: wallClockIso(r.changedAt),
      what: `Grade changed by the rules: ${r.fromGrade ?? '—'} → ${r.toGrade ?? '—'}`
        + (r.reason ? ` (${r.reason})` : ''),
      by: r.changedBy ?? 'system (rules)',
      workedState: state(r),
    })),
    ...recaptures.map((r) => ({
      kind: 'recapture' as const,
      leadId: String(r.leadId),
      propertyId: r.propertyId ?? null,
      owner: name(r),
      address: addr(r),
      cohort: r.logCohort ?? null,
      at: wallClockIso(r.recapturedAt),
      what: `Came back into play via ${r.process}`
        + (r.heldFromCohort ? ' — held out of this cycle, its send list was already built' : ''),
      by: r.process ?? null,
      workedState: state(r),
    })),
  ].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));

  const [notice] = await sql`
    SELECT "id","sentAt","sentTo","method" FROM "RetroNotice" WHERE "day" = ${day}::date` as Array<Record<string, any>>;

  return {
    day,
    changes,
    accountCount: new Set(changes.map((c) => c.leadId)).size,
    notice: notice
      ? {
        id: String(notice.id),
        sentAt: wallClockIso(notice.sentAt),
        sentTo: notice.sentTo ?? null,
        method: notice.method ?? null,
      }
      : null,
  };
}

/**
 * Build (or rebuild) the notice for a day.
 *
 * Written even when the day is empty. A day with a notice saying "nothing changed" and a day
 * where the job never ran look identical otherwise, and the second one is the failure — the
 * whole point is to be able to say the account was left alone, not merely to have nothing to
 * show.
 *
 * A day already SENT is not rebuilt. The payload is the evidence of what Ruben was actually
 * told, and regenerating it would quietly replace that with what the history says today.
 */
export async function buildDailyNotice(day: string): Promise<{
  id: string; day: string; changeCount: number; accountCount: number; rebuilt: boolean; alreadySent: boolean;
}> {
  const existing = await sql`
    SELECT "id","sentAt" FROM "RetroNotice" WHERE "day" = ${day}::date` as Array<Record<string, any>>;
  if (existing[0]?.sentAt) {
    const d = await getRetroChanges(day);
    return {
      id: String(existing[0].id), day, changeCount: d.changes.length,
      accountCount: d.accountCount, rebuilt: false, alreadySent: true,
    };
  }

  const d = await getRetroChanges(day);
  const id = existing[0]?.id ?? crypto.randomUUID();
  await sql`
    INSERT INTO "RetroNotice"
      ("id","day","generatedAt","changeCount","accountCount","payload","createdAt","updatedAt")
    VALUES (${id}, ${day}::date, NOW(), ${d.changes.length}, ${d.accountCount},
            ${JSON.stringify(d.changes)}::jsonb, NOW(), NOW())
    ON CONFLICT ("day") DO UPDATE
       SET "generatedAt"  = NOW(),
           "changeCount"  = EXCLUDED."changeCount",
           "accountCount" = EXCLUDED."accountCount",
           "payload"      = EXCLUDED."payload",
           "updatedAt"    = NOW()`;

  return {
    id, day, changeCount: d.changes.length, accountCount: d.accountCount,
    rebuilt: Boolean(existing[0]), alreadySent: false,
  };
}

/**
 * Record that the day's notice reached Ruben.
 *
 * Also stamps the recapture rows it covered, so the Recapture Log's "Ruben told" column and
 * this agree. Two places showing the same fact and disagreeing is the defect this project
 * keeps paying for; they are written together or not at all.
 */
export async function markNoticeSent(day: string, input: {
  sentTo?: string | null; sentBy?: string | null; method?: 'in_app' | 'email' | 'manual';
}): Promise<{ sent: boolean; recaptureRowsStamped: number }> {
  const rows = await sql`
    UPDATE "RetroNotice"
       SET "sentAt" = NOW(), "sentTo" = ${input.sentTo ?? 'Ruben'},
           "sentBy" = ${input.sentBy ?? null}, "method" = ${input.method ?? 'manual'},
           "updatedAt" = NOW()
     WHERE "day" = ${day}::date AND "sentAt" IS NULL
    RETURNING "id"` as Array<{ id: string }>;

  const ids = await sql`
    SELECT "id" FROM "RecaptureLog"
     WHERE "recapturedAt"::date = ${day}::date AND "rubenNotifiedAt" IS NULL` as Array<{ id: string }>;
  const stamped = ids.length
    ? await markRubenNotified(ids.map((r) => String(r.id)), input.sentBy ?? 'daily notice')
    : 0;

  return { sent: rows.length > 0, recaptureRowsStamped: stamped };
}

/**
 * Days that had something to report and never went out.
 *
 * This is the rule as Frank stated it — "no retroactive change to a worked account without
 * notifying Ruben" — expressed as a list. An empty list is the rule being kept.
 */
export async function unsentNotices(limit = 30): Promise<Array<{
  day: string; changeCount: number; accountCount: number; generatedAt: string | null;
}>> {
  const rows = await sql`
    SELECT "day","changeCount","accountCount","generatedAt"
      FROM "RetroNotice"
     WHERE "sentAt" IS NULL AND "changeCount" > 0
     ORDER BY "day" DESC LIMIT ${Math.min(Number(limit) || 30, 200)}` as Array<Record<string, any>>;
  return rows.map((r) => ({
    // A DATE column arrives as a Date object. String(date) yields "Wed Sep 24 2026 …", so
    // slicing ten characters off it returns "Wed Sep 24" — a string that looks like it might
    // be a date and sorts alphabetically. Read through the same local lens the driver used.
    day: wallClockIso(r.day)?.slice(0, 10) ?? String(r.day),
    changeCount: Number(r.changeCount),
    accountCount: Number(r.accountCount),
    generatedAt: wallClockIso(r.generatedAt),
  }));
}
