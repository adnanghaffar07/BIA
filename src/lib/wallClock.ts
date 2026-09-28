/**
 * Rendering a `timestamp without time zone` without moving it.
 *
 * ── The trap ────────────────────────────────────────────────────────────────
 * Almost every timestamp in this database is `timestamp without time zone`: Lead.ratedAt,
 * Activity.createdAt, GradeChange.changedAt, RecaptureLog.recapturedAt, ProcessRun.startedAt.
 * Postgres stores a wall clock and no zone. The driver hands it to JavaScript as a Date
 * parsed in the SERVER's local zone, so a row written at 19:33 UTC comes back as a Date
 * meaning 19:33 Pacific — seven hours in the future.
 *
 * `toISOString()` then faithfully prints that shifted instant, and the shift is invisible
 * because the output is a perfectly well-formed timestamp. It has already cost this project
 * twice: eight timestamps were written back seven hours out on a real lead, and stalledRuns()
 * silently never fired, because "started less than an hour ago" was true of a run that began
 * seven hours in the future.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Compare these columns in SQL, where they never leave Postgres. Render them with the
 * function below, which reads the Date back through the same local lens the driver used and
 * so returns the wall clock that was stored.
 *
 * The result deliberately carries NO trailing Z and no offset. A browser parses a bare
 * `2026-09-24T19:33:08` as local time, which displays the stored wall clock — which is what
 * every one of these columns means.
 */
/**
 * The agency's timezone. Every human-facing time belongs in it.
 *
 * Frank, 25 Sep 2026: "Timestamps show UTC. 4:40 AM on the log was 12:40 AM ET. We need
 * Eastern, because calling-hours rules and day counts depend on it."
 *
 * Named rather than written inline in each formatter: a call placed outside legal calling
 * hours is a real problem, and the one thing worse than the wrong zone is two places
 * disagreeing about which zone is right.
 */
export const AGENCY_TZ = 'America/New_York';

/**
 * A stored timestamp that holds UTC → the true instant.
 *
 * Postgres writes `NOW()` into a `timestamp without time zone` as the session's clock, and
 * this database's session is UTC. So "2026-09-25 04:42:08" means 04:42 UTC — which is
 * 12:42 AM in New Jersey, the previous day.
 *
 * The driver, and `new Date("2026-09-25 04:42:08")`, both read that as LOCAL, producing a
 * Date that is neither the stored value nor the real instant. Appending the Z is what makes
 * it mean what it says.
 *
 * NOT interchangeable with wallClockIso below. That one preserves a stored wall clock for
 * columns whose value is a wall clock; this one converts a stored UTC instant for display.
 * Using either in the other's place is how 04:42 became 4:42 AM on a log Frank reads.
 */
export function utcStoredToDate(stored: unknown): Date | null {
  if (stored == null) return null;
  if (stored instanceof Date) return Number.isNaN(stored.getTime()) ? null : stored;
  const s = String(stored).trim();
  if (!s) return null;
  // Already carries a zone — trust it.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A `datetime-local` value the operator typed → the UTC instant to store.
 *
 * ── Why this is needed at all ───────────────────────────────────────────────
 * `attemptedAt` is written by Postgres NOW() and holds UTC. `callbackAt` was written
 * straight from the picker, which yields a bare wall clock with no zone — so one column
 * held UTC and the other held whatever clock the operator's laptop was set to, in the same
 * table, with nothing marking the difference.
 *
 * The value is read as EASTERN rather than as the browser's zone. An operator scheduling a
 * callback means a time in the agency's day; if Ruben travels, or somebody works from a
 * machine set to another zone, the callback must not move.
 *
 * DST is handled by asking Intl what the offset actually was on that date rather than
 * assuming a fixed one — the difference between -5 and -4 is an hour, and a callback an
 * hour early is a call to a homeowner before legal calling hours.
 */
export function easternInputToUtc(local: string | null | undefined): string | null {
  const s = String(local ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;

  /** Provisional instant, treating the typed clock as UTC. */
  const guess = new Date(`${s.length === 16 ? `${s}:00` : s}Z`);
  if (Number.isNaN(guess.getTime())) return null;

  /**
   * What that instant reads as in New York. The gap between it and the typed value is the
   * offset, found twice because applying it can cross a DST boundary and change it.
   */
  const readBack = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: AGENCY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d).reduce<Record<string, string>>((a, x) => {
      a[x.type] = x.value; return a;
    }, {});
    return Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? '00' : p.hour), +p.minute, +p.second);
  };

  let utc = guess.getTime() + (guess.getTime() - readBack(guess));
  utc = new Date(utc).getTime() + (guess.getTime() - readBack(new Date(utc)));

  const d = new Date(utc);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** A stored UTC timestamp, written the way somebody in New Jersey would read it. */
export function easternDisplay(stored: unknown): string {
  const d = utcStoredToDate(stored);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: AGENCY_TZ,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/**
 * The Eastern calendar date of a stored UTC timestamp, as YYYY-MM-DD.
 *
 * This is what a day COUNT has to be built on. A call at 04:42 UTC happened the previous
 * evening in New Jersey, so counting distinct days on the raw stored string splits one
 * evening's calling across two days — and the unreachable rule ("3+ days") turns on exactly
 * that count.
 */
export function easternDay(stored: unknown): string {
  const d = utcStoredToDate(stored);
  if (!d) return '';
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return p;
}

export function wallClockIso(d: unknown): string | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(date.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
