import crypto from 'crypto';
import { pool } from '@/lib/neon';

/**
 * The 10% holdout — Grade A Outreach Playbook §00, "non-negotiable".
 *
 * "Without it we cannot tell binds the campaign caused from binds that would have
 * happened anyway."
 *
 * A held-out lead is never mailed. At the end of the cycle the bind rate of the held-out
 * group is what the campaign's bind rate is measured against; without that comparison a
 * bind rate is a number with nothing to be better than.
 *
 * ── Why a hash and not a random draw ────────────────────────────────────────
 * The assignment has to be STABLE. If a lead could move between groups — because a job
 * re-ran, or because the cohort grew and a percentile boundary shifted — the experiment
 * is worthless, and the failure would be invisible in the results. Deriving the group
 * from a hash of the lead id makes it a pure function of the lead: the same lead lands in
 * the same group forever, no matter when or how often this runs.
 *
 * The assignment is also written once and never revisited. holdoutAssignedAt is the
 * record that a lead has been through the process, which the old NOT NULL DEFAULT false
 * column could not express — every row read "not held out" whether it had been assigned
 * or never considered.
 *
 * ── Stratified by cohort ────────────────────────────────────────────────────
 * Assigned within each renewal week rather than across the book, so no single week can
 * end up with no control group or a third of it held back. The hash does this naturally:
 * because the bucket is independent of the cohort, each cohort gets ~10% on its own.
 * Actual per-cohort percentages are reported so any real skew is visible rather than
 * assumed away.
 */

/** Playbook §00. Not a tuning knob — changing it invalidates comparisons across cycles. */
export const HOLDOUT_PERCENT = 10;

/**
 * Which bucket 0–99 a lead falls in. Pure function of the id.
 *
 * md5 is used as a distribution function, not a security primitive: all that matters is
 * that the output is evenly spread and identical every time for a given id.
 */
export function holdoutBucket(leadId: string): number {
  const hash = crypto.createHash('md5').update(String(leadId)).digest();
  return hash.readUInt16BE(0) % 100;
}

/** Whether a lead belongs to the control group. */
export function isHoldout(leadId: string): boolean {
  return holdoutBucket(leadId) < HOLDOUT_PERCENT;
}

export type HoldoutResult = {
  considered: number;
  assigned: number;
  heldOut: number;
  alreadyAssigned: number;
  byCohort: Array<{ cohort: string; leads: number; heldOut: number; percent: number }>;
  dryRun: boolean;
};

/**
 * Assign every unassigned lead to treatment or control.
 *
 * Idempotent and one-way: a lead that already carries holdoutAssignedAt is left alone,
 * so re-running can only ever add newly-arrived leads. Nothing here can move a lead
 * between groups, which is the property the whole measurement depends on.
 *
 * @param cohort  restrict to one renewal week; omit for the whole book
 * @param dryRun  count what would happen and write nothing
 */
export async function assignHoldout(
  opts: { cohort?: string; dryRun?: boolean } = {},
): Promise<HoldoutResult> {
  const dryRun = opts.dryRun ?? false;

  const where = opts.cohort ? `WHERE "cohort" = $1` : '';
  const params = opts.cohort ? [opts.cohort] : [];

  const { rows: candidates } = await pool.query(
    `SELECT "id", "cohort" FROM "Lead" ${where}`,
    params,
  );

  const { rows: assignedRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "Lead" ${where ? `${where} AND` : 'WHERE'} "holdoutAssignedAt" IS NOT NULL`,
    params,
  );
  const alreadyAssigned = assignedRows[0]?.n ?? 0;

  // Decide first, write second, so a dry run and a real run take the identical path.
  const decisions = candidates.map((r) => ({
    id: String(r.id),
    cohort: r.cohort ?? null,
    held: isHoldout(String(r.id)),
  }));

  let assigned = 0;
  if (!dryRun) {
    const held = decisions.filter((d) => d.held).map((d) => d.id);
    const not = decisions.filter((d) => !d.held).map((d) => d.id);

    // Only rows never assigned are touched — the guard that makes this one-way.
    const write = async (ids: string[], flag: boolean) => {
      if (!ids.length) return 0;
      const { rowCount } = await pool.query(
        `UPDATE "Lead"
            SET "holdoutFlag" = $2,
                "holdoutAssignedAt" = NOW(),
                "holdoutCohort" = "cohort",
                "updatedAt" = NOW()
          WHERE "id" = ANY($1::text[])
            AND "holdoutAssignedAt" IS NULL`,
        [ids, flag],
      );
      return rowCount ?? 0;
    };
    assigned += await write(held, true);
    assigned += await write(not, false);
  }

  // Reported from the decisions rather than re-queried, so a dry run shows the same split
  // a real run would produce.
  const byCohortMap = new Map<string, { leads: number; heldOut: number }>();
  for (const d of decisions) {
    const key = d.cohort ?? '(untagged)';
    const cur = byCohortMap.get(key) ?? { leads: 0, heldOut: 0 };
    cur.leads++;
    if (d.held) cur.heldOut++;
    byCohortMap.set(key, cur);
  }
  const byCohort = [...byCohortMap.entries()]
    .map(([cohort, v]) => ({
      cohort,
      leads: v.leads,
      heldOut: v.heldOut,
      percent: v.leads ? Math.round((v.heldOut / v.leads) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));

  return {
    considered: candidates.length,
    assigned,
    heldOut: decisions.filter((d) => d.held).length,
    alreadyAssigned,
    byCohort,
    dryRun,
  };
}
