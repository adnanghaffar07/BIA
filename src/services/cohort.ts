/**
 * The cohort a lead belongs to: its renewal week, labelled by the MONDAY.
 *
 * '2026-11-09' means 09 Nov – 15 Nov 2026. Derived from the renewal effective date and
 * nothing else, so it is stable, recomputable and partitions every lead exactly once.
 *
 * ── The definition of record is the database ─────────────────────────────────
 * "Lead"."cohort" is maintained by the lead_cohort_trg trigger (migration 021), because
 * effectiveDate is written from several places — two of them generic builders that
 * assemble columns from a payload — and any app-side derivation would eventually drift.
 * What is here MIRRORS that trigger for labelling, filtering and stamping a send; it is
 * not where the value comes from. If one changes, change both.
 *
 * ── Why Monday-to-Sunday and not Frank's window ──────────────────────────────
 * Frank names a pull inclusively: "11/09/2026 to 11/16/2026". Taken literally that is
 * eight days, and consecutive pulls share a Monday — on the live data that window holds
 * 1,519 leads, of which 149 are dated 11/16 and also belong to the following week. A tag
 * has to partition, so the stored cohort is the non-overlapping week. Reports keep
 * taking an explicit from/to range and are unchanged by this.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Monday of the week containing `effectiveDate`, or null if the date is missing or
 * not a clean ISO date.
 *
 * All arithmetic is UTC. A local-time Date would shift the day either side of midnight
 * depending on where the server runs, which for a Monday-anchored week means a Sunday
 * renewal silently landing in the wrong cohort.
 */
export function cohortOf(effectiveDate: string | Date | null | undefined): string | null {
  if (!effectiveDate) return null;

  const iso = effectiveDate instanceof Date
    ? effectiveDate.toISOString().slice(0, 10)
    : String(effectiveDate).slice(0, 10);
  if (!ISO_DATE.test(iso)) return null;

  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  // getUTCDay: 0 = Sunday. Sunday belongs to the week that began six days earlier, not
  // to the one starting the next day.
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

/** Inclusive last day of a cohort week — the Sunday. */
export function cohortEnd(cohort: string): string | null {
  if (!ISO_DATE.test(cohort)) return null;
  const d = new Date(`${cohort}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * How a cohort reads to a person: "Nov 9 – 15, 2026".
 *
 * Deliberately not the bare Monday. A producer looking at a column of dates cannot tell
 * whether '2026-11-09' means a single day's renewals or a week's, and that ambiguity is
 * exactly what the cohort exists to remove.
 */
export function cohortLabel(cohort: string | null | undefined): string {
  if (!cohort || !ISO_DATE.test(cohort)) return '—';
  const end = cohortEnd(cohort);
  if (!end) return cohort;

  const s = new Date(`${cohort}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = (d: Date) => d.getUTCDate();

  // Same month reads "Nov 9 – 15"; a week straddling one reads "Nov 30 – Dec 6".
  return month(s) === month(e)
    ? `${month(s)} ${day(s)} – ${day(e)}, ${e.getUTCFullYear()}`
    : `${month(s)} ${day(s)} – ${month(e)} ${day(e)}, ${e.getUTCFullYear()}`;
}
