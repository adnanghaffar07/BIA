import { sql } from '@/lib/neon';

/**
 * QC / data-validation reports (Frank Jul-2026). The CRM captures producer notes,
 * variance notes, carrier-eligibility overrides and grade overrides — these reports
 * let Frank/Ruben pull that data back out to spot trends without cross-referencing
 * the Travelers portal by hand.
 */
export type QcReportType = 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch';

export interface QcRow {
  propertyId: string;
  owner: string;
  city: string | null;
  zip: string | null;
  effectiveDate: string | null;
  grade: string | null;
  manualGrade: string | null;
  propertyType: string | null;
  travelersEligible: string | null;
  plymouthEligible: string | null;
  context: string;        // the matching comment / reason / grade transition
  by: string | null;
  at: string | null;
}

export interface QcReportParams {
  carrier?: 'travelers' | 'plymouth' | 'any';
  value?: 'review' | 'ineligible' | 'eligible'; // 'review' == Referral
  q?: string;
  effFrom?: string;
  effTo?: string;
}

const nm = (r: any) => `${String(r.owner1FirstName ?? '').replace('null', '').trim()} ${String(r.owner1LastName ?? '').trim()}`.trim();
const iso = (d: any) => (d ? String(d).slice(0, 10) : null);
const eligLabel = (v: any) => (v === 'review' ? 'Referral' : v === 'ineligible' ? 'Non-eligible' : v === 'eligible' ? 'Eligible' : (v ?? '—'));

/** Apply an optional effective-date range in JS (row counts are small). */
function inRange(effDate: string | null, from?: string, to?: string): boolean {
  if (!effDate) return !from && !to;
  if (from && effDate < from) return false;
  if (to && effDate > to) return false;
  return true;
}

export async function getQcReport(type: QcReportType, params: QcReportParams = {}): Promise<QcRow[]> {
  const { carrier = 'any', value = 'review', q = '', effFrom, effTo } = params;

  let rows: any = [];

  if (type === 'referral') {
    // Carrier eligibility = Referral (or the requested value) on one/both carriers.
    if (carrier === 'travelers') {
      rows = await sql`SELECT * FROM "Lead" WHERE "travelersEligible" = ${value}`;
    } else if (carrier === 'plymouth') {
      rows = await sql`SELECT * FROM "Lead" WHERE "plymouthEligible" = ${value}`;
    } else {
      rows = await sql`SELECT * FROM "Lead" WHERE "travelersEligible" = ${value} OR "plymouthEligible" = ${value}`;
    }
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const bits: string[] = [];
        if (r.travelersEligible === value) bits.push(`Travelers: ${eligLabel(value)}${r.travelersEligibilityReason ? ` — ${r.travelersEligibilityReason}` : ''}`);
        if (r.plymouthEligible === value) bits.push(`Plymouth: ${eligLabel(value)}${r.plymouthEligibilityReason ? ` — ${r.plymouthEligibilityReason}` : ''}`);
        return rowOf(r, bits.join('  |  '));
      });
  }

  if (type === 'grade_overrides') {
    rows = await sql`
      SELECT l.*, a."metadata" AS a_meta, a."content" AS a_content, a."createdBy" AS a_by, a."createdAt" AS a_at
      FROM "Lead" l JOIN "Activity" a ON a."leadId" = l."id" AND a."type" = 'grade_override'
      ORDER BY a."createdAt" DESC`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const ch = (r.a_meta?.changes ?? []).find((c: any) => c.field === 'Grade');
        const transition = ch ? `${ch.from} → ${ch.to}` : (r.manualGrade ? `→ ${r.manualGrade}` : 'override');
        const reason = r.gradeOverrideReason || r.a_content || '';
        return rowOf(r, `${transition}${reason ? ` — ${reason}` : ''}`, r.a_by, iso(r.a_at));
      });
  }

  if (type === 'keyword') {
    const term = q.trim();
    if (!term) return [];
    const like = `%${term}%`;
    rows = await sql`
      SELECT DISTINCT l.*, (
        SELECT string_agg(a."content", ' ¦ ') FROM "Activity" a
        WHERE a."leadId" = l."id" AND a."content" ILIKE ${like}
      ) AS note_hits
      FROM "Lead" l
      WHERE l."varianceNotes" ILIKE ${like}
         OR l."travelersEligibilityReason" ILIKE ${like}
         OR l."plymouthEligibilityReason" ILIKE ${like}
         OR l."gradeOverrideReason" ILIKE ${like}
         OR EXISTS (SELECT 1 FROM "Activity" a WHERE a."leadId" = l."id" AND a."content" ILIKE ${like})`;
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const firstMatch = (r: any): string => {
      const candidates = [r.note_hits, r.varianceNotes, r.travelersEligibilityReason, r.plymouthEligibilityReason, r.gradeOverrideReason];
      for (const c of candidates) if (c && rx.test(String(c))) return String(c);
      return r.varianceNotes || r.gradeOverrideReason || '(match in notes)';
    };
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => rowOf(r, firstMatch(r)));
  }

  if (type === 'roof_b') {
    // Grade-B leads whose only knock is an unconfirmed roof on a 20+ yr home (non-condo).
    rows = await sql`
      SELECT * FROM "Lead"
      WHERE "grade" = 'B' AND "manualGrade" IS NULL AND "roofYear" IS NULL
        AND ("propertyType" IS NULL OR "propertyType" <> 'CONDO')
        AND ("landUse" IS NULL OR "landUse" NOT ILIKE '%condo%')
        AND "yearBuilt" IS NOT NULL
        AND (EXTRACT(YEAR FROM NOW())::int - "yearBuilt") > 20
      ORDER BY "yearBuilt" ASC`;
    const year = new Date().getFullYear();
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const age = r.yearBuilt ? year - Number(r.yearBuilt) : null;
        return rowOf(r, `Home ${age ?? '?'} yrs (built ${r.yearBuilt}) — roof unconfirmed`);
      });
  }

  if (type === 'type_mismatch') {
    // Producer-flagged: REAPI property type looks wrong (e.g. condo that's really a home).
    rows = await sql`SELECT * FROM "Lead" WHERE "propertyTypeMismatch" = true ORDER BY "effectiveDate"`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => rowOf(r, `CRM type: ${r.propertyType ?? '—'} — flagged as likely wrong by producer`));
  }

  return [];
}

function rowOf(r: any, context: string, by: string | null = null, at: string | null = null): QcRow {
  return {
    propertyId: r.propertyId,
    owner: nm(r) || '—',
    city: r.addressCity ?? null,
    zip: r.addressZip ?? null,
    effectiveDate: iso(r.effectiveDate),
    grade: r.grade ?? null,
    manualGrade: r.manualGrade ?? null,
    propertyType: r.propertyType ?? null,
    travelersEligible: r.travelersEligible ?? null,
    plymouthEligible: r.plymouthEligible ?? null,
    context,
    by,
    at,
  };
}
