import { sql } from '@/lib/neon';
import { MERGE_FIELD_NAMES } from '@/lib/mergeFields';

/**
 * Merge variables whose value is the same for every homeowner (migration 047).
 *
 * The copy asks for {{agency_website}} and {{office_address}}. Neither is a property of a
 * lead — every contact gets the identical string — so nothing produced them and the platform
 * printed nothing. Five such names were blank across all eight live campaigns on 30 Sep.
 *
 * ── What must NOT be stored here ────────────────────────────────────────────
 * Anything whose value differs per homeowner. A renewal date typed once and sent to every
 * household reads perfectly and is wrong for all but one of them, which is worse than the
 * blank it replaced — a blank is visibly broken and somebody fixes it. reserve() below
 * refuses any name the per-lead builder already produces, so that mistake cannot be made by
 * typing; it has to be argued for in code.
 */

export type GlobalMergeVar = {
  name: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Reserved by the sending platform. Ours would be ignored in favour of theirs. */
const PLATFORM_NAMES = new Set([
  'firstName', 'lastName', 'companyName', 'website', 'phone', 'personalization', 'email',
  'accountSignature', 'sendingAccountFirstName', 'sendingAccountLastName',
  'sendingAccountEmail', 'emailAccount', 'unsubscribeLink',
]);

/**
 * Why a name cannot be used, or null if it can.
 *
 * Checked before anything is written. A variable that collides with a per-lead field would
 * either be silently overridden or silently override — and which one depends on the order
 * two objects are merged in, which is not a thing anybody should have to know to set an
 * office address.
 */
export function nameProblem(name: string): string | null {
  const n = String(name ?? '').trim();
  if (!n) return 'Give it a name.';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(n)) {
    return 'Use letters, numbers and underscores only, starting with a letter — the name has '
      + 'to work as {{' + 'name' + '}} in an email.';
  }
  if (PLATFORM_NAMES.has(n)) {
    return `The sending platform already provides {{${n}}} and will use its own value.`;
  }
  if (MERGE_FIELD_NAMES.has(n)) {
    return `{{${n}}} is already built from each lead's own record, so it is different for every `
      + 'homeowner. A single typed value would go to all of them.';
  }
  return null;
}

export async function listGlobalMergeVars(): Promise<GlobalMergeVar[]> {
  const rows = await sql`
    SELECT "name","value","description","updatedAt"::text AS "updatedAt","updatedBy"
      FROM "MergeVariable" ORDER BY "name"` as Array<Record<string, any>>;
  return rows.map((r) => ({
    name: String(r.name),
    value: String(r.value ?? ''),
    description: r.description ?? null,
    updatedAt: r.updatedAt ? String(r.updatedAt).slice(0, 16).replace('T', ' ') : null,
    updatedBy: r.updatedBy ?? null,
  }));
}

/**
 * Name → value, for the push and the export.
 *
 * Empty values are left OUT, not sent as blanks. A key present with an empty string is a
 * populated cell containing nothing, which renders mid-sentence and tells nobody; an absent
 * key shows up in the copy check as a gap somebody has to close. Same rule as the band.
 */
export async function globalMergeVars(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const v of await listGlobalMergeVars()) {
    const value = v.value.trim();
    if (value) out[v.name] = value;
  }
  return out;
}

export async function upsertGlobalMergeVar(input: {
  name: string; value: string; description?: string | null; by?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const problem = nameProblem(input.name);
  if (problem) return { ok: false, error: problem };
  await sql`
    INSERT INTO "MergeVariable" ("name","value","description","updatedAt","updatedBy")
    VALUES (${input.name.trim()}, ${String(input.value ?? '')},
            ${input.description ?? null}, NOW(), ${input.by ?? null})
    ON CONFLICT ("name") DO UPDATE
      SET "value" = EXCLUDED."value",
          "description" = COALESCE(EXCLUDED."description", "MergeVariable"."description"),
          "updatedAt" = NOW(),
          "updatedBy" = EXCLUDED."updatedBy"`;
  return { ok: true };
}

export async function deleteGlobalMergeVar(name: string): Promise<void> {
  await sql`DELETE FROM "MergeVariable" WHERE "name" = ${name}`;
}
