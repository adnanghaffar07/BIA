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
export function wallClockIso(d: unknown): string | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(date.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    + `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
