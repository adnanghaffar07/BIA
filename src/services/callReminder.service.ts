import { sql } from '@/lib/neon';
import { easternDisplay } from '@/lib/wallClock';
import { addActivity } from './storage.service';

/**
 * Call reminders — "nobody picked up, try again in fifteen minutes".
 *
 * ── Not a callback ──────────────────────────────────────────────────────────
 * CallAttempt.callbackAt is a time the HOMEOWNER agreed to, set only on the outcomes that
 * need one, and it is what "callbacks honoured" will be measured on. This is the caller's
 * own note to himself, and most of these will be dialled a few minutes either side of the
 * minute they name. Sharing one column would make every retry look like a promise.
 *
 * ── Every time is computed here, never sent by a browser ────────────────────
 * dueAt is written as NOW() + an interval. Two separate bugs in this project came from a
 * laptop's local clock reaching a `timestamp without time zone` column — a callback due
 * today that never appeared, and a stalled-run check that never fired. "In 15 minutes" is
 * unambiguous and needs no timezone.
 */

export type Reminder = {
  id: string;
  leadId: string;
  propertyId: string | null;
  phone: string | null;
  /** For display. The raw column is read as a wall clock; this is Eastern, spelled out. */
  dueAt: string;
  dueLabel: string;
  /** Negative once it is due, so the caller can see how late it is. */
  minutesUntil: number;
  note: string | null;
  createdBy: string | null;
  owner: string | null;
  address: string | null;
  /**
   * How it ended, once it has. 'called' and 'dropped' are both closed and only one is work
   * done — a log that could not tell them apart could not say how much of the queue got
   * worked, only how much of it stopped being shown.
   */
  closed: 'called' | 'dropped' | null;
  closedLabel: string | null;
  closedBy: string | null;
};

/** Offsets the buttons offer. Anything else is typed in as minutes. */
export const QUICK_MINUTES = [10, 15, 30, 60] as const;

const MAX_MINUTES = 60 * 24 * 14;

export async function createReminder(input: {
  leadId: string;
  propertyId?: string | null;
  phone?: string | null;
  minutes: number;
  note?: string | null;
  createdBy?: string | null;
}): Promise<Reminder | null> {
  const minutes = Math.round(Number(input.minutes));
  /**
   * A reminder in the past fires immediately and looks like a bug; one a year out is a
   * fat-fingered number. Both are refused rather than stored and puzzled over later.
   */
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) return null;

  const rows = await sql`
    INSERT INTO "CallReminder"
      ("id","leadId","propertyId","phone","dueAt","note","createdBy","createdAt")
    VALUES (${crypto.randomUUID()}, ${input.leadId}, ${input.propertyId ?? null},
            ${input.phone ?? null},
            -- Server clock, server arithmetic. The browser never supplies a time.
            NOW() + (${String(minutes)} || ' minutes')::interval,
            ${input.note ?? null}, ${input.createdBy ?? null}, NOW())
    RETURNING "id"` as Array<{ id: string }>;

  const made = await listReminders({ id: rows[0]?.id });

  /**
   * On the lead's timeline as well as in the reminder table.
   *
   * Everything a producer does to a card belongs in one readable history — somebody asking
   * "what happened with this lead" should not have to know which of five tables to open.
   * The reminder table stays the working queue; this is the record.
   */
  if (made[0]) {
    await addActivity(
      input.leadId, 'note',
      `Call reminder set for ${made[0].dueLabel}${input.phone ? ` on ${input.phone}` : ''}`
        + `${input.note ? ` — "${input.note}"` : ''}`,
      {}, input.createdBy ?? undefined,
    ).catch(() => { /* the reminder matters more than the note about it */ });
  }
  return made[0] ?? null;
}

/**
 * Open reminders, soonest first.
 *
 * `dueAt` is compared in SQL rather than in JS. Reading a `timestamp without time zone`
 * through the driver hands back a Date already shifted into server-local terms, so a
 * comparison here against a JS `now` is out by the server's offset — which is exactly how
 * a stalled-run check sat silent for a week.
 */
export async function listReminders(opts: {
  id?: string;
  leadId?: string;
  /** Only those already due. */
  dueOnly?: boolean;
  /** Include ones already acted on or dropped. */
  includeClosed?: boolean;
  limit?: number;
} = {}): Promise<Reminder[]> {
  const rows = await sql`
    SELECT r."id", r."leadId", r."propertyId", r."phone",
           r."dueAt"::text AS "dueAt",
           -- Computed in SQL against the same clock that wrote it.
           EXTRACT(EPOCH FROM (r."dueAt" - NOW())) / 60 AS "minutesUntil",
           r."note", r."createdBy",
           r."doneAt"::text AS "doneAt", r."doneBy",
           r."dismissedAt"::text AS "dismissedAt", r."dismissedBy",
           l."owner1FirstName", l."owner1LastName", l."addressStreet", l."addressCity"
      FROM "CallReminder" r
      LEFT JOIN "Lead" l ON l."id" = r."leadId"
     WHERE (${opts.id ?? null}::text IS NULL OR r."id" = ${opts.id ?? null})
       AND (${opts.leadId ?? null}::text IS NULL OR r."leadId" = ${opts.leadId ?? null})
       AND (${opts.includeClosed ?? false} OR (r."doneAt" IS NULL AND r."dismissedAt" IS NULL))
       AND (NOT ${opts.dueOnly ?? false} OR r."dueAt" <= NOW())
     -- Open ones by when they are due; closed ones most recent first, because the log is
     -- read backwards from now. COALESCE gives one ordering key for both.
     ORDER BY (r."doneAt" IS NOT NULL OR r."dismissedAt" IS NOT NULL),
              CASE WHEN r."doneAt" IS NULL AND r."dismissedAt" IS NULL THEN r."dueAt" END ASC,
              COALESCE(r."doneAt", r."dismissedAt") DESC
     LIMIT ${Math.min(Math.max(Number(opts.limit) || 100, 1), 500)}` as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const owner = [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ').trim();
    return {
      id: String(r.id),
      leadId: String(r.leadId),
      propertyId: r.propertyId ? String(r.propertyId) : null,
      phone: r.phone ? String(r.phone) : null,
      dueAt: String(r.dueAt ?? ''),
      dueLabel: easternDisplay(r.dueAt),
      minutesUntil: Math.round(Number(r.minutesUntil ?? 0)),
      note: r.note ? String(r.note) : null,
      createdBy: r.createdBy ? String(r.createdBy) : null,
      owner: owner || null,
      address: [r.addressStreet, r.addressCity].filter(Boolean).join(', ') || null,
      closed: r.doneAt ? 'called' : (r.dismissedAt ? 'dropped' : null),
      closedLabel: r.doneAt ? easternDisplay(r.doneAt) : (r.dismissedAt ? easternDisplay(r.dismissedAt) : null),
      closedBy: (r.doneBy ?? r.dismissedBy) ? String(r.doneBy ?? r.dismissedBy) : null,
    };
  });
}

/**
 * Close a reminder.
 *
 * 'done' means the call was made; 'dismissed' means not now, drop it. Both end it, only one
 * is work — a queue that cannot tell them apart cannot say how much of it got worked.
 */
export async function closeReminder(
  id: string,
  how: 'done' | 'dismissed',
  by: string | null,
  /** What closed it, for the timeline line. A call logged against the lead, or a person. */
  because: 'call_logged' | 'by_hand' = 'by_hand',
): Promise<boolean> {
  // Read first, so the activity note can name the number and the lead after the update.
  const before = await listReminders({ id, includeClosed: true });
  const rows = how === 'done'
    ? await sql`
        UPDATE "CallReminder" SET "doneAt" = NOW(), "doneBy" = ${by}
         WHERE "id" = ${id} AND "doneAt" IS NULL AND "dismissedAt" IS NULL
        RETURNING "id"` as Array<{ id: string }>
    : await sql`
        UPDATE "CallReminder" SET "dismissedAt" = NOW(), "dismissedBy" = ${by}
         WHERE "id" = ${id} AND "doneAt" IS NULL AND "dismissedAt" IS NULL
        RETURNING "id"` as Array<{ id: string }>;
  if (!rows.length) return false;

  const r = before[0];
  if (r) {
    await addActivity(
      r.leadId, 'note',
      how === 'done'
        ? (because === 'call_logged'
            ? `Call reminder cleared — an outcome was logged for ${r.phone ?? 'this lead'}`
            : `Call reminder marked done by hand${r.phone ? ` (${r.phone})` : ''}`)
        : `Call reminder dropped without calling${r.phone ? ` (${r.phone})` : ''}`,
      {}, by ?? undefined,
    ).catch(() => { /* closing matters more than the note about it */ });
  }
  return true;
}

/**
 * Close every open reminder on a lead because a call was actually logged.
 *
 * ── Why this exists rather than a "Called" button ───────────────────────────
 * The reminder list used to have one, and it closed the reminder without recording a call.
 * A producer who tapped it and then did not log an outcome left the reminder log saying
 * "called" while the lead's call history, the attempt count and the phone dashboard's
 * "called at least once" all said nothing had happened.
 *
 * Now the only thing that can mark a reminder called is a call being logged. The two cannot
 * disagree, because one of them is derived from the other.
 */
export async function closeRemindersForCall(leadId: string, by: string | null): Promise<number> {
  const open = await listReminders({ leadId });
  let closed = 0;
  for (const r of open) {
    if (await closeReminder(r.id, 'done', by, 'call_logged')) closed++;
  }
  return closed;
}

/**
 * For the phone screen's header.
 *
 * `called` and `dropped` cover the last 24 hours rather than all time: the panel is a
 * working record for a shift, and a lifetime total would stop moving and stop meaning
 * anything within a week.
 */
export async function reminderCounts(): Promise<{
  open: number; due: number; calledToday: number; droppedToday: number;
}> {
  const [r] = await sql`
    SELECT COUNT(*) FILTER (WHERE "doneAt" IS NULL AND "dismissedAt" IS NULL)::int AS open,
           COUNT(*) FILTER (WHERE "doneAt" IS NULL AND "dismissedAt" IS NULL
                              AND "dueAt" <= NOW())::int AS due,
           COUNT(*) FILTER (WHERE "doneAt"      >= NOW() - interval '24 hours')::int AS called_today,
           COUNT(*) FILTER (WHERE "dismissedAt" >= NOW() - interval '24 hours')::int AS dropped_today
      FROM "CallReminder"` as Array<Record<string, unknown>>;
  return {
    open: Number(r?.open ?? 0),
    due: Number(r?.due ?? 0),
    calledToday: Number(r?.called_today ?? 0),
    droppedToday: Number(r?.dropped_today ?? 0),
  };
}
