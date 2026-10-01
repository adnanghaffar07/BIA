import { getCampaign, updateCampaignSequences, listCampaigns } from '@/lib/integrations/leadCampaign';
import { tokensIn, MERGE_FIELD_NAMES } from '@/lib/mergeFields';

/**
 * Repair the copy held on the sending platform, from the CRM.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * The subject and the body were typed into the platform by hand, so every sentence existed
 * twice and the two copies drifted. Measured on 2 Oct across the live campaigns:
 *
 *   {{first_name}}   in 6 campaigns   the built-in is firstName, so this renders NOTHING
 *                                     and the opening line reads "Hi ,"
 *   {{cta1}}         in 3 campaigns   ours is cta_1, so the ask disappears
 *   {{streetAddress}} in 1 campaign   ours is street_address
 *   subjects         em-dash lost, one truncated to "the last stretc", one step 1
 *                    carrying the step 2 line
 *
 * ── Why it only renames tokens and the subject ──────────────────────────────
 * This does NOT rewrite prose. Zoya writes the copy; the CRM is not a better author of it,
 * and a tool that silently reworded a sentence somebody approved would never be trusted
 * again. Two changes only:
 *
 *   1. a token that nothing fills is renamed to the one that does — a mechanical fix with
 *      a right answer, where the current text is provably broken;
 *   2. the subject becomes {{subject_N}} so the sentence comes from the Subject lines
 *      screen per contact, which is the whole point: one source, no retyping.
 *
 * Anything else — a token we have no mapping for, a missing signature field — is REPORTED
 * and left alone, because the fix is a decision rather than a rename.
 */

/**
 * Tokens somebody typed, against the name that actually exists.
 *
 * Every entry is a case where the current token fills with nothing, so renaming it cannot
 * make the email worse. A token merely in the wrong STYLE but working is not in here.
 */
const TOKEN_FIXES: Record<string, string> = {
  first_name: 'firstName',
  last_name: 'lastName',
  cta1: 'cta_1',
  cta2: 'cta_2',
  cta3: 'cta_3',
  streetAddress: 'street_address',
  streetName: 'street_name',
  renewalDate: 'renewal_date',
  bandLow: 'band_low',
  bandHigh: 'band_high',
};

export interface CopyChange {
  step: number;
  variant: number;
  field: 'subject' | 'body';
  from: string;
  to: string;
  why: string;
}

export interface CampaignCopyPlan {
  campaignId: string;
  campaignName: string;
  changes: CopyChange[];
  /** Tokens nothing fills that this cannot rename — a person has to decide. */
  unresolved: Array<{ token: string; where: string }>;
  /** Built from a fresh read, and sent back unchanged apart from `changes`. */
  sequences: unknown[];
}

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Rename the broken tokens in one string, preserving the author's spacing style. */
function renameTokens(text: string): { out: string; renamed: string[] } {
  const renamed: string[] = [];
  const out = String(text ?? '').replace(TOKEN_RE, (whole, name: string) => {
    const fixed = TOKEN_FIXES[name];
    if (!fixed) return whole;
    renamed.push(`${name} → ${fixed}`);
    // Keep the spacing the author used: {{ x }} stays spaced, {{x}} stays tight.
    return whole.includes('{{ ') ? `{{ ${fixed} }}` : `{{${fixed}}}`;
  });
  return { out, renamed };
}

export async function planCampaignCopy(campaignId: string): Promise<CampaignCopyPlan> {
  const campaign = await getCampaign(campaignId);
  const sequences = (campaign as Record<string, any>)?.sequences ?? [];
  const changes: CopyChange[] = [];
  const unresolved: Array<{ token: string; where: string }> = [];

  /**
   * Deep-cloned before anything is touched.
   *
   * The PATCH replaces the whole sequences array, so this object becomes what the campaign
   * IS. Mutating the response object in place would be fine today and quietly destructive
   * the moment anything else reads it first.
   */
  const next = JSON.parse(JSON.stringify(sequences)) as Array<Record<string, any>>;

  for (const seq of next) {
    const steps: Array<Record<string, any>> = seq?.steps ?? [];
    steps.forEach((step, si) => {
      const variants: Array<Record<string, any>> = step?.variants ?? [];
      variants.forEach((v, vi) => {
        const stepNo = si + 1;

        // ── The subject becomes the variable ────────────────────────────
        const subject = String(v?.subject ?? '');
        const wanted = `{{subject_${stepNo}}}`;
        if (subject.trim() && subject.trim() !== wanted && stepNo <= 3) {
          v.subject = wanted;
          changes.push({
            step: stepNo, variant: vi + 1, field: 'subject', from: subject, to: wanted,
            why: 'The subject now comes from the Subject lines screen, per contact, so the '
              + 'sentence lives in one place instead of being retyped here.',
          });
        }

        // ── Broken tokens in the body ───────────────────────────────────
        const body = String(v?.body ?? '');
        const { out, renamed } = renameTokens(body);
        if (renamed.length) {
          v.body = out;
          changes.push({
            step: stepNo, variant: vi + 1, field: 'body', from: body, to: out,
            why: `Renamed ${renamed.join(', ')} — the old name is not a variable we send, `
              + 'so it was rendering as nothing.',
          });
        }

        // ── What is left that nothing fills ─────────────────────────────
        for (const t of tokensIn(out)) {
          if (MERGE_FIELD_NAMES.has(t) || TOKEN_FIXES[t]) continue;
          unresolved.push({ token: t, where: `step ${stepNo}, variant ${vi + 1}` });
        }
      });
    });
  }

  return {
    campaignId,
    campaignName: String((campaign as Record<string, any>)?.name ?? campaignId),
    changes,
    unresolved: [...new Map(unresolved.map((u) => [`${u.token}|${u.where}`, u])).values()],
    sequences: next,
  };
}

/**
 * Apply a plan.
 *
 * Re-plans immediately before writing rather than trusting the plan it was handed. The
 * preview may be minutes old and the platform is edited by people — applying a stale plan
 * would silently revert whatever they did in between, because this write replaces the whole
 * sequence rather than patching a field.
 */
export async function applyCampaignCopy(campaignId: string): Promise<{
  applied: number; plan: CampaignCopyPlan; verified: boolean;
}> {
  const plan = await planCampaignCopy(campaignId);
  if (!plan.changes.length) return { applied: 0, plan, verified: true };

  await updateCampaignSequences(campaignId, plan.sequences);

  /**
   * Read back. A 200 from this vendor has already been shown to mean nothing — the
   * contact-variable PATCH answers 200 and stores nothing — so the only honest report is
   * one built from what the platform holds afterwards.
   */
  const after = await planCampaignCopy(campaignId);
  return { applied: plan.changes.length, plan, verified: after.changes.length === 0 };
}

/** Every campaign, with what would change. Read-only. */
export async function planAllCampaigns(): Promise<CampaignCopyPlan[]> {
  const campaigns = await listCampaigns();
  const out: CampaignCopyPlan[] = [];
  for (const c of campaigns) {
    try { out.push(await planCampaignCopy(String(c.id))); } catch { /* skip unreadable */ }
  }
  return out;
}
