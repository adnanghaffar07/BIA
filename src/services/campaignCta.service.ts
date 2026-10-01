import { sql } from '@/lib/neon';
import { CTA_BY_STEP, GRADE_B_CTA } from './campaignSegment.service';
import { unknownTokensIn } from '@/lib/mergeFields';
import { globalMergeVars } from './globalMergeVars.service';

/**
 * The three calls to action, read from the database rather than the source.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The wording lived in CTA_BY_STEP, a constant. Zoya writes the copy and cannot edit a
 * TypeScript file, so every change to a sentence a homeowner reads needed a developer and a
 * deploy. agency_website and the merge variables moved out of the code for the same reason;
 * this is the last piece of homeowner-facing copy that was still compiled in.
 *
 * ── The constant is still the floor ─────────────────────────────────────────
 * An empty row falls back to the old arm-1 wording. A blank CTA is a visible gap in an
 * email that otherwise sends perfectly, and a screen that lets somebody empty a field by
 * accident should not be able to empty an email by accident.
 */

export interface Cta {
  step: 1 | 2 | 3;
  label: string;
  wording: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Tokens in the wording that no merge field will fill — these print as braces. */
  unknownTokens: string[];
  /** True when the wording needs the agency website, which is not set yet. */
  needsWebsite: boolean;
}

const FALLBACK: Record<number, string> = {
  1: CTA_BY_STEP[1][1].wording,
  2: CTA_BY_STEP[2][1].wording,
  3: CTA_BY_STEP[3][1].wording,
};

const WEBSITE_TOKEN = /\{\{\s*agency_website\s*\}\}/;

export async function getCtas(): Promise<Cta[]> {
  const rows = await sql`
    SELECT "step", "label", "wording", "updatedAt", "updatedBy"
      FROM "CampaignCta" ORDER BY "step"` as Array<Record<string, any>>;
  const bySt = new Map(rows.map((r) => [Number(r.step), r]));
  return ([1, 2, 3] as const).map((step) => {
    const r = bySt.get(step);
    const wording = String(r?.wording ?? '').trim() || FALLBACK[step];
    return {
      step,
      label: String(r?.label ?? `Ask — email ${step}`),
      wording,
      updatedAt: r?.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      updatedBy: r?.updatedBy ?? null,
      unknownTokens: unknownTokensIn(wording, CTA_ONLY_TOKENS),
      needsWebsite: WEBSITE_TOKEN.test(wording),
    };
  });
}

/**
 * The wording a lead should get for one step.
 *
 * Grade B keeps its own single ask (§3, "R4 · Single arm, wave two") — it is a different
 * offer, not a variant of this one, so it is not editable from the same three rows and is
 * not silently overwritten by them.
 */
export async function ctaWordingFor(step: number, segment: string): Promise<string> {
  if (segment === 'grade_b') return GRADE_B_CTA.wording;
  const all = await getCtas();
  return all.find((c) => c.step === step)?.wording ?? '';
}

export interface CtaProblem { field: 'wording' | 'label'; message: string }

/**
 * What is wrong with a proposed CTA, before it is saved.
 *
 * Checked here rather than in the page so the API cannot be used to store something the
 * screen would have refused — the merge-variables screen learned that the hard way when a
 * value typed past the form reached a live contact.
 */
/**
 * Tokens a CTA may use that campaign copy may not.
 *
 * agency_website is not a per-contact merge field and is deliberately absent from
 * MERGE_FIELD_NAMES: a template containing it would print braces, because the platform has
 * no such variable. In a CTA it is different — fill() inside mergeVarsFor resolves it on our
 * side before the wording is ever sent, so by the time a contact holds cta_3 the link is
 * already in it. Without this the validator refuses the wording it was seeded with.
 */
const CTA_ONLY_TOKENS = ['agency_website'];

export function ctaProblems(
  label: string,
  wording: string,
  /** Names created on the Email variables screen, which are equally usable here. */
  alsoKnown: Iterable<string> = [],
): CtaProblem[] {
  const out: CtaProblem[] = [];
  if (!label.trim()) out.push({ field: 'label', message: 'Give the ask a short name.' });
  const w = wording.trim();
  if (!w) {
    out.push({ field: 'wording', message: 'Empty — the email would send with no ask in it.' });
    return out;
  }
  if (w.length > 300) {
    out.push({ field: 'wording', message: 'Over 300 characters. A call to action is one sentence.' });
  }
  /**
   * A token nothing fills prints as braces in the email. This is the exact failure that put
   * "{{ agency_website }}/meet" in front of 92 of 186 C1–C3 contacts, so it is refused at
   * the point of typing rather than reported afterwards.
   */
  const unknown = unknownTokensIn(w, [...CTA_ONLY_TOKENS, ...alsoKnown]);
  if (unknown.length) {
    out.push({
      field: 'wording',
      message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a' : 'are not'} merge `
        + 'field, so it would print as braces in the email.',
    });
  }
  return out;
}

export async function setCta(
  step: number,
  label: string,
  wording: string,
  by: string | null,
): Promise<{ ok: true } | { ok: false; problems: CtaProblem[] }> {
  if (![1, 2, 3].includes(step)) {
    return { ok: false, problems: [{ field: 'wording', message: 'There are three asks, one per email.' }] };
  }
  /**
   * A variable somebody created on the Email variables screen is usable in an ask. Loading
   * the names here means the two screens cannot disagree about what exists — the editor
   * calling a real variable unknown is how a warning gets trained away.
   */
  const custom = Object.keys(await globalMergeVars());
  const problems = ctaProblems(label, wording, custom);
  if (problems.length) return { ok: false, problems };

  await sql`
    INSERT INTO "CampaignCta" ("step", "label", "wording", "updatedAt", "updatedBy")
    VALUES (${step}, ${label.trim()}, ${wording.trim()}, NOW(), ${by})
    ON CONFLICT ("step") DO UPDATE
      SET "label" = EXCLUDED."label",
          "wording" = EXCLUDED."wording",
          "updatedAt" = NOW(),
          "updatedBy" = EXCLUDED."updatedBy"`;
  return { ok: true };
}

/**
 * The three wordings as mergeVarsFor wants them: { 1: '…', 2: '…', 3: '…' }.
 *
 * Every caller that builds variables for a real contact loads this. A caller that does not
 * falls back to the compiled wording, which is right for an export preview and wrong for a
 * send — so the send paths all pass it, and this helper exists so none of them has to
 * reshape the rows themselves and get it subtly different.
 */
export async function ctaWordings(): Promise<Record<number, string>> {
  const all = await getCtas();
  return Object.fromEntries(all.map((c) => [c.step, c.wording]));
}
