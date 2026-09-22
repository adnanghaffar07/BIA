import { pool, sql } from '@/lib/neon';
import { groupHouseholds, addressKeyOf, type Household } from './household.service';

/**
 * Write the households down (directive Sec. 11.5 question 2).
 *
 * The grouping itself is unchanged — groupHouseholds() in household.service.ts is still
 * the only place that decides who lives with whom. This is the half that persists the
 * answer, so the key stops being a function that can silently reinterpret history.
 *
 * ── Identity is a surrogate, and it is STABLE ───────────────────────────────
 * groupHouseholds names a group after its lowest lead id. That is reproducible within one
 * run and not stable between runs: a new lead with a lower id joins, and the group's name
 * changes underneath every suppression recorded against it.
 *
 * So materialisation never uses the group's own key as identity. It matches an incoming
 * group to an EXISTING Household row — by any address it covers, then by any lead already
 * assigned — and only mints a new id when nothing matches. A household keeps its id for
 * life, through leads arriving and leaving.
 *
 * ── Merges are real and are recorded ────────────────────────────────────────
 * Two households become one the moment a lead appears that shares an email with both.
 * When that happens the oldest row wins — it is the one existing suppressions point at —
 * and the others are folded into it. The alternative, minting a third id, would orphan
 * every suppression on both sides.
 */

export type MaterialiseResult = {
  leadsSeen: number;
  groups: number;
  created: number;
  updated: number;
  merged: number;
  leadsAssigned: number;
  /** Households covering more than one property — worth a human glance. */
  multiAddress: Array<{ id: string; addressKeys: string[]; leadIds: string[] }>;
  dryRun: boolean;
};

type LeadRow = Record<string, unknown>;

/** Every column the grouping reads. Selecting * would drag 238 columns per lead. */
const GROUPING_COLUMNS = `
  "id", "addressStreet", "addressZip", "householdId",
  "email1", "email2", "owner2Email", "emailsAll", "skipTraceData"`;

/**
 * Rebuild household membership from the leads.
 *
 * Safe to re-run: it is a convergence, not an append. A second run over unchanged leads
 * creates nothing and reassigns nothing.
 */
export async function materialiseHouseholds(opts?: {
  dryRun?: boolean;
  by?: string | null;
}): Promise<MaterialiseResult> {
  const dryRun = opts?.dryRun ?? true;
  const by = opts?.by ?? 'materialise';

  const leads = await sql(`SELECT ${GROUPING_COLUMNS} FROM "Lead"`) as LeadRow[];
  const { households } = groupHouseholds(leads);

  // Existing rows, so a re-run matches rather than duplicates.
  const existing = await sql`
    SELECT "id", "addressKey" FROM "Household"` as Array<{ id: string; addressKey: string | null }>;
  const byAddress = new Map<string, string>();
  for (const h of existing) if (h.addressKey) byAddress.set(h.addressKey, h.id);

  const currentByLead = new Map<string, string>();
  for (const l of leads) {
    const hid = l.householdId ? String(l.householdId) : '';
    if (hid) currentByLead.set(String(l.id), hid);
  }

  const out: MaterialiseResult = {
    leadsSeen: leads.length, groups: households.length,
    created: 0, updated: 0, merged: 0, leadsAssigned: 0,
    multiAddress: [], dryRun,
  };

  type Plan = { id: string; isNew: boolean; absorbed: string[]; group: Household };
  const plans: Plan[] = [];

  for (const g of households) {
    /**
     * Every id this group already touches, from either direction. More than one means
     * the group has grown to span households that used to be separate.
     */
    const candidates = new Set<string>();
    for (const ak of g.addressKeys) { const id = byAddress.get(ak); if (id) candidates.add(id); }
    for (const leadId of g.leadIds) { const id = currentByLead.get(leadId); if (id) candidates.add(id); }

    // Oldest id wins a merge: lexicographic on a time-ordered id is chronological, and
    // the oldest is the one any existing suppression was recorded against.
    const sorted = [...candidates].sort();
    const id = sorted[0] ?? `hh_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const isNew = sorted.length === 0;
    const absorbed = sorted.slice(1);

    if (isNew) out.created++; else out.updated++;
    out.merged += absorbed.length;
    plans.push({ id, isNew, absorbed, group: g });

    if (g.addressKeys.length > 1) {
      out.multiAddress.push({ id, addressKeys: g.addressKeys, leadIds: g.leadIds });
    }
    for (const leadId of g.leadIds) {
      if (currentByLead.get(leadId) !== id) out.leadsAssigned++;
    }
  }

  if (dryRun) return out;

  /**
   * One transaction for the whole rebuild.
   *
   * Half-applied membership is the worst possible state: a household-scope suppression
   * would cover some of its members and not others, which is indistinguishable from
   * working and is exactly what this whole record exists to prevent.
   */
  /**
   * Written in batches, not row by row.
   *
   * The first version issued two statements per household — on ~9,900 households that is
   * ~20,000 sequential round trips to a serverless database, which took over ten minutes
   * and held a transaction on Lead the whole time. This is a script meant to run after
   * every pull, so that shape is wrong twice over: slow, and a long write transaction on
   * a live table is something to keep short on principle.
   *
   * CHUNK stays well under Postgres's 65,535 parameter ceiling — 500 households is 2,500
   * parameters for the insert and 1,000 for the lead update.
   */
  const CHUNK = 500;
  const chunks = <T,>(xs: T[]) => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
    return out;
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const batch of chunks(plans)) {
      const hv: unknown[] = [];
      const hRows = batch.map((p, i) => {
        const g = p.group;
        hv.push(p.id, g.addressKeys.length === 1 ? g.addressKeys[0] : null,
          g.addressKeys.length, g.leadIds.length, by);
        const b = i * 5;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},NOW(),$${b + 5})`;
      });
      await client.query(
        `INSERT INTO "Household" ("id","addressKey","addressCount","leadCount","derivedAt","derivedBy")
         VALUES ${hRows.join(',')}
         ON CONFLICT ("id") DO UPDATE SET
           "addressKey"   = EXCLUDED."addressKey",
           "addressCount" = EXCLUDED."addressCount",
           "leadCount"    = EXCLUDED."leadCount",
           "derivedAt"    = NOW(),
           "derivedBy"    = EXCLUDED."derivedBy",
           "updatedAt"    = NOW()`,
        hv,
      );

      // One UPDATE ... FROM (VALUES ...) for every lead in the batch's households.
      const lv: unknown[] = [];
      const lRows: string[] = [];
      for (const p of batch) {
        for (const leadId of p.group.leadIds) {
          lv.push(leadId, p.id);
          const b = lv.length - 2;
          lRows.push(`($${b + 1},$${b + 2})`);
        }
      }
      if (lRows.length) {
        await client.query(
          `UPDATE "Lead" SET "householdId" = v.hid, "updatedAt" = NOW()
             FROM (VALUES ${lRows.join(',')}) AS v(lead_id, hid)
            WHERE "Lead"."id" = v.lead_id
              AND "Lead"."householdId" IS DISTINCT FROM v.hid`,
          lv,
        );
      }
    }

    /**
     * Carry existing suppressions onto the household id.
     *
     * A lead can be suppressed before it has a household — a pull creates it, a hard
     * bounce or a "stop" reply arrives, and materialisation has not run yet. In that
     * window householdScopeKey falls back to the address key, so the Suppression row is
     * written as `hh:<street>|<zip>`. Once the lead has an id, every reader asks for the
     * id, and that row would quietly stop matching: the household would look unsuppressed
     * and go back into a send.
     *
     * So the key is rewritten to the id as the id is assigned. Scoped to the leads in this
     * group, and only where the stored key is one this group would have produced, so it
     * cannot capture a suppression belonging to somebody else.
     */
    const leadIds = plans.flatMap((p) => p.group.leadIds);
    if (leadIds.length) {
      await client.query(
        `UPDATE "Suppression" s
            SET "householdKey" = l."householdId"
           FROM "Lead" l
          WHERE s."leadId" = l."id"
            AND s."scope" = 'household'
            AND s."releasedAt" IS NULL
            AND l."householdId" IS NOT NULL
            AND s."householdKey" IS DISTINCT FROM l."householdId"
            AND l."id" = ANY($1::text[])`,
        [leadIds],
      );
    }

    // Only the groups that actually absorbed another household. Almost always none —
    // a merge happens when a new lead shares an email with two previously separate
    // households — so this loop usually does not run at all.
    for (const p of plans.filter((x) => x.absorbed.length)) {
      /**
       * Absorbed rows are deleted only AFTER their leads have been repointed above — and
       * a confirmed address on one of them is carried across first, because it was a real
       * decision by a real homeowner and losing it would silently widen the send list
       * back out to every address on the card.
       */
      for (const old of p.absorbed) {
        await client.query(
          `UPDATE "Household" h SET
             "confirmedEmail" = COALESCE(h."confirmedEmail", o."confirmedEmail"),
             "confirmedAt"    = COALESCE(h."confirmedAt",    o."confirmedAt"),
             "confirmedVia"   = COALESCE(h."confirmedVia",   o."confirmedVia"),
             "updatedAt"      = NOW()
           FROM "Household" o WHERE h."id" = $1 AND o."id" = $2`,
          [p.id, old],
        );
        await client.query(`DELETE FROM "Household" WHERE "id" = $1`, [old]);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return out;
}

export type HouseholdMismatch = {
  leadId: string;
  stored: string | null;
  derived: string | null;
  reason: 'unassigned' | 'disagrees';
};

/**
 * Re-derive and compare, without writing anything.
 *
 * The point of storing the answer was that a change to the derivation becomes visible
 * instead of silently reinterpreting history. That only holds if something actually looks.
 * Run it after any change to normaliseStreet, addressKeyOf or groupHouseholds — the unit
 * numbers incident would have shown up here as 4 leads changing household.
 */
export async function householdMismatches(): Promise<{
  checked: number;
  mismatches: HouseholdMismatch[];
}> {
  const leads = await sql(`SELECT ${GROUPING_COLUMNS} FROM "Lead"`) as LeadRow[];
  const { households } = groupHouseholds(leads);

  const storedByLead = new Map<string, string | null>();
  for (const l of leads) storedByLead.set(String(l.id), l.householdId ? String(l.householdId) : null);

  // The derived grouping has its own volatile keys, so compare SHAPE rather than name:
  // two leads that derive into one group must share a stored id, and vice versa.
  const derivedGroupOf = new Map<string, string>();
  for (const g of households) for (const id of g.leadIds) derivedGroupOf.set(id, g.key);

  const mismatches: HouseholdMismatch[] = [];
  const storedForDerived = new Map<string, string>();

  for (const l of leads) {
    const leadId = String(l.id);
    const stored = storedByLead.get(leadId) ?? null;
    const derived = derivedGroupOf.get(leadId) ?? null;
    if (!stored) { mismatches.push({ leadId, stored, derived, reason: 'unassigned' }); continue; }
    if (!derived) continue;

    const seen = storedForDerived.get(derived);
    if (!seen) storedForDerived.set(derived, stored);
    else if (seen !== stored) {
      // Two leads the derivation puts together are stored apart — the case a household
      // suppression would half-miss.
      mismatches.push({ leadId, stored, derived, reason: 'disagrees' });
    }
  }
  return { checked: leads.length, mismatches };
}

/** The stored household for a lead, or null while it is unassigned. */
export async function householdIdOf(leadId: string): Promise<string | null> {
  const [row] = await sql`
    SELECT "householdId" FROM "Lead" WHERE "id" = ${leadId}` as Array<{ householdId: string | null }>;
  return row?.householdId ?? null;
}

/** Address-only view, for reporting the households that span several properties. */
export async function multiAddressHouseholds(): Promise<Array<{
  id: string; addressCount: number; leadCount: number; leadIds: string[];
}>> {
  // Awaited before the cast: the tagged template's return type is a union that includes
  // a full result object, and asserting on the promise rather than its value claims an
  // overlap the compiler is right to reject.
  const rows = await sql`
    SELECT h."id", h."addressCount", h."leadCount",
           ARRAY_AGG(l."id" ORDER BY l."id") AS "leadIds"
      FROM "Household" h
      JOIN "Lead" l ON l."householdId" = h."id"
     WHERE h."addressCount" > 1
     GROUP BY h."id", h."addressCount", h."leadCount"
     ORDER BY h."addressCount" DESC`;
  return rows as Array<{ id: string; addressCount: number; leadCount: number; leadIds: string[] }>;
}

/** Kept so callers do not reach for addressKeyOf directly and drift from the grouping. */
export { addressKeyOf };
