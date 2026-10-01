import { sql } from '@/lib/neon';
import { subjectFor, type Segment } from './campaignSegment.service';
import { cohortNumber } from './cohort';
import { unknownTokensIn } from '@/lib/mergeFields';
import { globalMergeVars } from './globalMergeVars.service';

/**
 * The subject lines, read from the database rather than the source.
 *
 * The CTAs moved out of the code first and this follows the same reasoning: Zoya writes the
 * copy and cannot edit a TypeScript constant, so changing a sentence a homeowner reads
 * needed a developer and a deploy.
 *
 * ── What did NOT change ─────────────────────────────────────────────────────
 * Who gets which line. §5 varies the subject by segment, cohort, step and A/B variant —
 * priced copy only to priced accounts, C6/C7 introducing before they quote, Grade B on the
 * roof — and all 25 rows are preserved. The storage moved; the strategy did not.
 *
 * ── subjectFor() is still the floor ─────────────────────────────────────────
 * A lookup that finds nothing falls back to the compiled function. A subject line is the
 * one field an email cannot send without: a blank subject is both an unopened email and a
 * spam signal, so there is no path here that returns an empty string.
 */

export interface SubjectRow {
  id: string;
  segment: Segment;
  step: number;
  variant: 'A' | 'B';
  /** Cohort codes this line covers. Empty means every cohort. */
  cohorts: string[];
  name: string;
  template: string;
  updatedAt: string | null;
  updatedBy: string | null;
  unknownTokens: string[];
}

export async function getSubjects(): Promise<SubjectRow[]> {
  const rows = await sql`
    SELECT "id","segment","step","variant","cohorts","name","template","updatedAt","updatedBy"
      FROM "CampaignSubject"
     ORDER BY "segment", "step", "variant", "cohorts"` as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: String(r.id),
    segment: r.segment as Segment,
    step: Number(r.step),
    variant: r.variant as 'A' | 'B',
    cohorts: Array.isArray(r.cohorts) ? r.cohorts : [],
    name: String(r.name),
    template: String(r.template),
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    updatedBy: r.updatedBy ?? null,
    unknownTokens: unknownTokensIn(String(r.template)),
  }));
}

/**
 * Every stored line, keyed so a lookup is a map read rather than a query per lead.
 *
 * Built once per push and handed to mergeVarsFor, the same way the globals and the CTAs
 * are. A per-lead query here would be one round trip per contact on a list of several
 * hundred.
 */
export type SubjectLookup = Map<string, string>;

const keyOf = (segment: string, step: number, variant: string, cohort: string) =>
  `${segment}|${step}|${variant}|${cohort}`;

export async function subjectLookup(): Promise<SubjectLookup> {
  const rows = await getSubjects();
  const out: SubjectLookup = new Map();
  for (const r of rows) {
    // An empty cohort list means "every cohort" — Grade B's single pair.
    const codes = r.cohorts.length ? r.cohorts : ['*'];
    /**
     * Grade B's pair is step-agnostic, the same way GRADE_B_CTA is.
     *
     * §5.11 gives Grade B one pair, used at every step — the roof question does not become
     * a different question in the follow-up. Stored once at step 1, so without this the
     * lookup finds nothing for steps 2 and 3 and quietly serves the compiled wording
     * instead: an edit on the screen would change the first email and leave the rest, with
     * nothing anywhere reporting the split. The coverage check below is what caught it.
     */
    const steps = r.segment === 'grade_b' ? [1, 2, 3] : [r.step];
    for (const c of codes) {
      for (const s of steps) out.set(keyOf(r.segment, s, r.variant, c), r.template);
    }
  }
  return out;
}

/** The template for one lead, or '' when nothing is stored and the caller should fall back. */
export function subjectTemplateFrom(
  lookup: SubjectLookup,
  segment: string,
  cohort: string,
  step: number,
  variant: 'A' | 'B',
): string {
  const code = `C${cohortNumber(cohort)}`;
  return lookup.get(keyOf(segment, step, variant, code))
    ?? lookup.get(keyOf(segment, step, variant, '*'))
    ?? '';
}

export interface SubjectProblem { field: 'name' | 'template'; message: string }

/**
 * What is wrong with a proposed subject, before it is saved.
 *
 * The length limit is not cosmetic: most clients truncate a subject around 60 characters on
 * a phone, and a line whose point arrives at character 80 is a line nobody reads. It warns
 * rather than refuses, because a long subject is a judgement call and a broken token is not.
 */
export function subjectProblems(
  name: string,
  template: string,
  alsoKnown: Iterable<string> = [],
): SubjectProblem[] {
  const out: SubjectProblem[] = [];
  if (!name.trim()) out.push({ field: 'name', message: 'Give the line a short name — it appears in the version label.' });
  const t = template.trim();
  if (!t) {
    out.push({ field: 'template', message: 'Empty. An email with no subject does not get opened, and it reads as spam.' });
    return out;
  }
  const unknown = unknownTokensIn(t, alsoKnown);
  if (unknown.length) {
    out.push({
      field: 'template',
      message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a' : 'are not'} merge `
        + 'field, so it would print as braces in the subject line.',
    });
  }
  return out;
}

export async function setSubject(
  id: string,
  name: string,
  template: string,
  by: string | null,
): Promise<{ ok: true } | { ok: false; problems: SubjectProblem[] }> {
  const custom = Object.keys(await globalMergeVars());
  const problems = subjectProblems(name, template, custom);
  if (problems.length) return { ok: false, problems };
  const res = await sql`
    UPDATE "CampaignSubject"
       SET "name" = ${name.trim()}, "template" = ${template.trim()},
           "updatedAt" = NOW(), "updatedBy" = ${by}
     WHERE "id" = ${id}
 RETURNING "id"` as Array<Record<string, any>>;
  if (!res.length) {
    return { ok: false, problems: [{ field: 'template', message: 'That subject line no longer exists.' }] };
  }
  return { ok: true };
}

/**
 * Does every audience the system can produce have a stored line?
 *
 * Guards the cutover. If a combination is missing, the fallback quietly serves the compiled
 * wording and an edit on the screen appears to do nothing for that audience — the same
 * shape of bug as the QC export that kept printing the old CTAs.
 */
export async function subjectCoverage(): Promise<{
  checked: number; missing: Array<{ segment: string; cohort: string; step: number; variant: string }>;
}> {
  const lookup = await subjectLookup();
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
  const missing: Array<{ segment: string; cohort: string; step: number; variant: string }> = [];
  let checked = 0;
  const { stepsFor } = await import('./campaignSegment.service');
  for (const segment of ['rated', 'unrated', 'grade_b'] as const) {
    for (const week of weeks) {
      for (const step of stepsFor(week)) {
        for (const variant of ['A', 'B'] as const) {
          checked++;
          const stored = subjectTemplateFrom(lookup, segment, week, step, variant);
          const compiled = subjectFor({ segment, cohort: week, step, variant }).template;
          if (!stored && compiled) missing.push({ segment, cohort: week, step, variant });
        }
      }
    }
  }
  return { checked, missing };
}

/**
 * The stored lines as a plain object, keyed segment|step|variant|cohortCode.
 *
 * mergeVarsFor takes a Record rather than the Map so it stays free of this module — it is
 * imported by a client bundle path, and pulling a service that opens a database connection
 * into it is how a key ended up inlined into client JS once before.
 *
 * Every send path loads this. A path that forgets gets the compiled wording and no error,
 * which is exactly how the QC export went on printing CTAs that had been edited away.
 */
export async function subjectTemplates(): Promise<Record<string, string>> {
  return Object.fromEntries(await subjectLookup());
}
