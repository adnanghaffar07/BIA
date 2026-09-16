import { sql } from '@/lib/neon';
import { eligibilityReasonLabel } from '@/types/carrier';
import { compareOwnerNames } from './ownerNameMatch.service';
import { insuredEmails, coInsuredEmails } from './recipients.service';
import { cohortLabel } from './cohort';

/**
 * QC / data-validation reports (Frank Jul-2026). The CRM captures producer notes,
 * variance notes, carrier-eligibility overrides and grade overrides — these reports
 * let Frank/Ruben pull that data back out to spot trends without cross-referencing
 * the Travelers portal by hand.
 */
export type QcReportType = 'referral' | 'grade_overrides' | 'keyword' | 'roof_b' | 'type_mismatch' | 'owner_verify' | 'contact_coverage' | 'skiptrace_mismatch' | 'blast_skiptrace' | 'cohort' | 'reachability';

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
  // Contact-coverage report only — lets the UI tally the breakdown.
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasDob?: boolean;
  isCondo?: boolean;
  // Reachability report only — the UI tallies the cohort summary from these.
  cohort?: string | null;
  /** Addresses belonging to the named insured — exactly what the push would mail. */
  insuredEmailCount?: number;
  /** A co-insured address we hold and do NOT mail, and which the insured set lacks. */
  coInsuredOnly?: boolean;
  // Blast report only — groups the rows of one run.
  runId?: string | null;
  /** Whether Tracerfy matched. Credits are deliberately NOT reported here
   *  (Frank Sep-2026): QC is for data quality, and a per-lead price turns a
   *  coverage review into a spend review. Low balance is surfaced instead. */
  matched?: boolean;
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
/**
 * Date columns come back in two shapes: effectiveDate and friends are TEXT
 * ('2026-09-11'), while real timestamps (gradeOverrideAt, ownerVerifyAt,
 * blastSkipTracedAt, Activity.createdAt) come back as Date objects. Slicing
 * String(date) yielded 'Fri Sep 11' — wrong, and unsortable. Nobody noticed
 * because the QC table never rendered the "at" column until Sep-2026.
 *
 * Those columns are "timestamp WITHOUT time zone", so the driver hands back a
 * Date already in local terms. toISOString() would re-interpret it as UTC and
 * shift it — an evening run would be reported as the next day. Read the local
 * parts instead.
 */
const iso = (d: any): string | null => {
  if (!d) return null;
  const local = (x: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  if (d instanceof Date) {
    return Number.isNaN(d.getTime()) ? null : local(d);
  }
  const s = String(d);
  // NOTE the backslashes. This was /^d{4}-d{2}-d{2}/ — matching a literal "d" — so no
  // real date ever took this branch. Every TEXT date fell through to `new Date(s)`,
  // which reads a bare 'YYYY-MM-DD' as UTC midnight; local() then rendered it in local
  // time and, west of UTC, handed back the PREVIOUS day. Effective dates were reported
  // and range-filtered one day early in every report, which is invisible unless you
  // reconcile a count against the database.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); // already ISO text
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : local(parsed);
};
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
    // BOTH sources: a producer's override and the rules re-grading on re-enrichment.
    //
    // Only the first was ever recorded, which made this report read as "grades barely
    // change" when in truth every system regrade was invisible. grade_system rows are
    // written from Sep-2026 onward; anything the rules changed before that left no
    // trace and cannot be recovered — which is why the drift rows below matter.
    /**
     * Matched on the RECORDED CHANGE, not on the activity type.
     *
     * This used to join a."type" = 'grade_override' and missed most of the data. A
     * grade edited from the lead card is written as a `note` carrying a changes array,
     * and only the dedicated override dialog writes 'grade_override' — so 243 of the
     * 283 A-downgrades in this database were invisible, and the report read as though
     * producers almost never regrade. That is what made a renewal week look like it had
     * lost ~90 Grade A leads: they had been deliberately downgraded, and the evidence
     * was in a row type nobody was looking at.
     *
     * Keying off the metadata means any future writer that records a Grade change shows
     * up here without this query needing to learn its name.
     */
    rows = await sql`
      SELECT l.*, a."metadata" AS a_meta, a."content" AS a_content, a."createdBy" AS a_by,
             a."createdAt" AS a_at, a."type" AS a_type
      FROM "Lead" l
      JOIN "Activity" a ON a."leadId" = l."id"
      WHERE a."metadata" -> 'changes' @> '[{"field":"Grade"}]'::jsonb
         OR a."type" = 'grade_system'
      ORDER BY a."createdAt" DESC`;
    const recorded: QcRow[] = rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const ch = (r.a_meta?.changes ?? []).find((c: any) => c.field === 'Grade');
        const transition = ch ? `${ch.from} → ${ch.to}` : (r.manualGrade ? `→ ${r.manualGrade}` : 'override');
        // Authorship decides the sub-tab, and it comes from the row rather than its
        // type: a `note` written by a producer is their change, a grade_system row has
        // no author because the rules made it.
        const system = r.a_type === 'grade_system' || !r.a_by;
        const reason = system ? '' : (r.gradeOverrideReason || r.a_content || '');
        return {
          ...rowOf(
            r,
            `${transition}${reason ? ` — ${reason}` : ''}`,
            system ? 'system (rules)' : r.a_by,
            iso(r.a_at),
          ),
          // The note path records its reason as free text rather than a dropdown code,
          // so fall back to it — otherwise most rows would show no reason at all.
          reason: system
            ? 'System regrade'
            : (r.gradeOverrideReason || (r.a_content ? String(r.a_content).slice(0, 80) : null)),
        };
      });

    return recorded;
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

  if (type === 'skiptrace_mismatch') {
    // Frank Aug-2026: leads where the skip-trace insured name disagrees with the on-file
    // name. Producers override per-lead from the card; this lists them for carrier-portal QC.
    rows = await sql`SELECT * FROM "Lead" WHERE "skipTraceOwnerName" IS NOT NULL AND "skipTraceOwnerName" <> '' ORDER BY "effectiveDate"`;
    return rows
      .filter((r: any) => {
        const c = compareOwnerNames({ first: r.owner1FirstName, last: r.owner1LastName }, String(r.skipTraceOwnerName));
        return c.result === 'mismatch';
      })
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => rowOf(r, `On file "${nm(r) || '—'}" → skip trace "${r.skipTraceOwnerName}"`));
  }

  if (type === 'blast_skiptrace') {
    // Frank Sep-2026: which leads were traced by a cohort BLAST rather than by a
    // producer clicking the card, when, by whom, and what each one actually returned.
    //
    // blastSkipTracedAt is the whole definition — it is written only by the blast
    // (migration 016), so the card button can never appear here. deepSkipTracedAt
    // cannot answer this: both routes set it.
    rows = await sql`SELECT * FROM "Lead" WHERE "blastSkipTracedAt" IS NOT NULL ORDER BY "blastSkipTracedAt" DESC`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const hasPhone = !!(String(r.phone1 ?? '').trim() || String(r.phone2 ?? '').trim());
        const hasEmail = !!(String(r.email1 ?? '').trim() || String(r.email2 ?? '').trim());
        const coInsured = [r.owner2FirstName, r.owner2LastName].filter(Boolean).join(' ');
        // A stored payload with hit=true is the only honest record of a charge: the
        // blast bills 15 on a match and nothing on a miss.
        const matched = (r.skipTraceData as any)?.hit === true;
        const got = [hasPhone ? 'phone' : null, hasEmail ? 'email' : null, coInsured ? `co-insured ${coInsured}` : null]
          .filter(Boolean).join(' + ');
        const context = matched
          ? `Matched — ${got || 'no contact returned'}`
          : 'No match';
        const row = rowOf(r, context, r.blastSkipTracedBy ?? null, iso(r.blastSkipTracedAt));
        return {
          ...row,
          // Short, stable label so rows from one run read as one run in the table.
          reason: r.blastRunId ? `Run ${String(r.blastRunId).slice(0, 8)}` : null,
          runId: r.blastRunId ?? null,
          hasPhone,
          hasEmail,
          matched,
        };
      });
  }

  if (type === 'reachability') {
    /**
     * Insured / co-insured / combined reachability, per cohort.
     *
     * The question behind it is a decision, not a statistic. Campaigns go to the named
     * insured only — the co-insured is deliberately excluded — and this is what that rule
     * costs: how many households we can reach at all, and how many we could reach ONLY by
     * mailing the co-insured. Without the last number nobody can judge whether the rule is
     * worth keeping.
     *
     * The insured count comes from the SAME function the push uses, so the report cannot
     * promise reach the push would not use. It is deliberately not a SQL predicate: the
     * insured's addresses are attributed per-person inside the trace payload, and the
     * existing "has email" SQL both misses email2/emailsAll and counts owner2Email — the
     * co-insured — as if it were the insured's.
     *
     * Every lead is a row, reachable or not. The denominator is the whole cohort; dropping
     * the unreachable ones would turn "30% reachable" into "100% of the reachable ones".
     */
    /**
     * Named columns, not SELECT *. This report reads the whole book rather than one
     * week, and `SELECT *` drags rawData — a large JSONB blob on every one of ~10,000
     * leads — over the wire for columns nothing here touches. Measured: 25s with the
     * star, well past any serverless limit. skipTraceData IS needed: it carries the
     * per-person attribution that decides which addresses are the insured's.
     *
     * The date range is pushed into SQL as well. inRange below still has the final say —
     * it is the shared rule every report uses — but there is no reason to ship rows over
     * the wire only to drop them in JS.
     */
    const from = effFrom || null;
    const to = effTo || null;
    rows = await sql`
      SELECT "propertyId", "owner1FirstName", "owner1LastName", "addressCity", "addressZip",
             "effectiveDate", "cohort", "grade", "manualGrade", "propertyType",
             "travelersEligible", "plymouthEligible", "deepSkipTracedAt",
             "email1", "email2", "owner2Email", "skipTraceData", "phone1", "phone2"
        FROM "Lead"
       WHERE "effectiveDate" IS NOT NULL
         AND (${from}::text IS NULL OR left("effectiveDate", 10) >= ${from})
         AND (${to}::text   IS NULL OR left("effectiveDate", 10) <= ${to})
       ORDER BY "cohort", "addressCity", "owner1LastName"`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const insured = insuredEmails(r);
        const coOnly = coInsuredEmails(r);

        const context = insured.length
          ? `${insured.length} insured address${insured.length === 1 ? '' : 'es'}`
            + (coOnly.length ? ' · co-insured also held' : '')
          : coOnly.length
            ? 'NO insured address — reachable only via the co-insured'
            : 'unreachable — no address for either party';

        return {
          ...rowOf(r, context, null, iso(r.deepSkipTracedAt)),
          // Labelled, not the bare Monday: a column of dates gives no clue whether one
          // means a single day's renewals or a week's.
          reason: cohortLabel(r.cohort),
          cohort: r.cohort ?? null,
          insuredEmailCount: insured.length,
          coInsuredOnly: coOnly.length > 0,
          hasEmail: insured.length > 0 || coOnly.length > 0,
          hasPhone: !!(String(r.phone1 ?? '').trim() || String(r.phone2 ?? '').trim()),
        };
      });
  }

  if (type === 'cohort') {
    // Every lead whose renewal falls in the window, graded or not.
    //
    // Deliberately unfiltered by status or grade: this answers "what is actually in
    // this week" before any decision has been taken about it. The other reports all
    // start from a judgement already made (a producer flagged it, a blast traced it);
    // this one is the denominator those are a subset of, which is why the ungraded
    // leads have to be in it rather than quietly dropped.
    //
    // Contactability is carried on every row because the cohort question is always
    // followed by "and how many can we actually email".
    rows = await sql`
      SELECT * FROM "Lead"
      WHERE "effectiveDate" IS NOT NULL
      ORDER BY "effectiveDate", "addressCity", "owner1LastName"`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const emails = Array.isArray(r.emailsAll) ? r.emailsAll.length : 0;
        const phones = Array.isArray(r.phonesAll) ? r.phonesAll.length : 0;
        const hasEmail = emails > 0
          || !!String(r.email1 ?? '').trim() || !!String(r.owner2Email ?? '').trim();
        const hasPhone = phones > 0 || !!String(r.phone1 ?? '').trim();
        const traced = !!r.deepSkipTracedAt;

        const context = [
          traced ? 'traced' : 'not traced',
          hasEmail ? `${Math.max(emails, hasEmail ? 1 : 0)} email${emails === 1 ? '' : 's'}` : 'no email',
          hasPhone ? `${Math.max(phones, hasPhone ? 1 : 0)} phone${phones === 1 ? '' : 's'}` : 'no phone',
        ].join(' · ');

        return {
          ...rowOf(r, context, null, iso(r.deepSkipTracedAt)),
          // The status is what splits new / quarantine / rated, and the UI tallies on it.
          reason: r.status ?? null,
          hasEmail,
          hasPhone,
          matched: traced,
        };
      });
  }

  if (type === 'contact_coverage') {
    // Frank Aug-2026: rated accounts broken down by property type (Condo/SFH) and
    // contact status (phone-only / email-only / both / neither) + DOB. The UI tallies
    // the summary from these rows; the no-email subset drives the downgrade decision.
    // `value` reuses the status field: 'review' default = rated; pass a status via ?value.
    rows = await sql`SELECT * FROM "Lead" WHERE "status" = 'rated' ORDER BY "effectiveDate"`;
    return rows
      .filter((r: any) => inRange(iso(r.effectiveDate), effFrom, effTo))
      .map((r: any) => {
        const hasPhone = !!(String(r.phone1 ?? '').trim() || String(r.phone2 ?? '').trim());
        const hasEmail = !!(String(r.email1 ?? '').trim() || String(r.email2 ?? '').trim());
        const hasDob = !!(r.reapiDob || r.owner1Dob);
        const isCondo = String(r.propertyType ?? '').toUpperCase() === 'CONDO'
          || /condo/i.test(r.landUse ?? '');
        const contact = hasPhone && hasEmail ? 'Phone + Email'
          : hasPhone ? 'Phone only'
          : hasEmail ? 'Email only'
          : 'No phone or email';
        const row = rowOf(r, `${contact}${hasDob ? ' · DOB' : ' · no DOB'}`);
        return { ...row, hasPhone, hasEmail, hasDob, isCondo };
      });
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
