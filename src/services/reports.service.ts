import { sql } from '@/lib/neon';
import { eligibilityReasonLabel } from '@/types/carrier';

/**
 * QC / data-validation reports (Frank Jul-2026). The CRM captures producer notes,
 * variance notes, carrier-eligibility overrides and grade overrides — these reports
 * let Frank/Ruben pull that data back out to spot trends without cross-referencing
 * the Travelers portal by hand.
 */
export type QcReportType = 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch' | 'owner_verify';

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
  /** Structured producer-selected reason (dropdown) — this is what trends are counted on. */
  reason: string | null;
  context: string;        // the matching comment / detail / grade transition
  by: string | null;
  at: string | null;
}

export interface QcReportParams {
  carrier?: 'travelers' | 'plymouth' | 'any';
  value?: 'review' | 'ineligible' | 'eligible'; // 'review' == Referral
  /**
   * Who put the lead in this state (Frank, Jul-2026 — "when I filter on referral I want
   * the ones WE did"). The appetite rules flag far more leads than producers actually
   * review, so the two get mixed in one list. A producer-set eligibility always carries
   * a reason code; a system flag never does — that is the distinction, no extra column.
   */
  setBy?: 'any' | 'producer' | 'system';
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
  const { carrier = 'any', value = 'review', setBy = 'any', q = '', effFrom, effTo } = params;

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
    // A reason code is only ever written when a producer changes eligibility, so its
    // presence is what separates "we reviewed this" from "the appetite rules flagged it".
    // Only count the reason on the carrier(s) actually in the requested state.
    const producerTouched = (r: any) =>
      (carrier !== 'plymouth' && r.travelersEligible === value && !!r.travelersEligibilityReason)
      || (carrier !== 'travelers' && r.plymouthEligible === value && !!r.plymouthEligibilityReason);
    return rows
      .filter((r: any) => (setBy === 'any' ? true : setBy === 'producer' ? producerTouched(r) : !producerTouched(r)))
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        // Structured reason (dropdown) is reported on; Detail carries the nuance.
        const reasons: string[] = [];
        const details: string[] = [];
        if (r.travelersEligible === value) {
          if (r.travelersEligibilityReason) reasons.push(`Travelers: ${eligibilityReasonLabel(r.travelersEligibilityReason)}`);
          if (r.travelersEligibilityDetail) details.push(`Travelers — ${r.travelersEligibilityDetail}`);
        }
        if (r.plymouthEligible === value) {
          if (r.plymouthEligibilityReason) reasons.push(`Plymouth: ${eligibilityReasonLabel(r.plymouthEligibilityReason)}`);
          if (r.plymouthEligibilityDetail) details.push(`Plymouth — ${r.plymouthEligibilityDetail}`);
        }
        // Fall back to the system's own carrier note when a producer hasn't set a reason.
        if (!details.length) {
          const sys = (() => {
            try {
              const n = typeof r.travelersNotes === 'string' ? JSON.parse(r.travelersNotes || '[]') : (r.travelersNotes ?? []);
              return (n as string[]).find((x) => !/Meets all/i.test(x)) ?? '';
            } catch { return ''; }
          })();
          if (sys) details.push(sys);
        }
        return rowOf(r, details.join('  |  '), null, null, reasons.join('  |  ') || null);
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

  if (type === 'owner_verify') {
    // WIP owner-name verification failures (Frank Aug-2026 — mandatory verify): the
    // property wasn't found on the tax roll ('not_found'), or the insured name disagrees
    // with it ('mismatch'). Both need a human's review before the lead goes to outreach.
    rows = await sql`
      SELECT * FROM "Lead"
      WHERE "ownerVerifyStatus" IN ('not_found', 'mismatch')
      ORDER BY "ownerVerifyAt" DESC NULLS LAST`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const label = r.ownerVerifyStatus === 'not_found' ? 'Not on tax roll' : 'Name mismatch';
        const detail = r.ownerVerifyName
          ? `${label} — roll shows "${r.ownerVerifyName}"`
          : (r.ownerVerifyDetail || label);
        return rowOf(r, detail, null, iso(r.ownerVerifyAt));
      });
  }

  return [];
}

function rowOf(r: any, context: string, by: string | null = null, at: string | null = null, reason: string | null = null): QcRow {
  return {
    reason,
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
