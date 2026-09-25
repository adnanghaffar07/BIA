import { sql } from '@/lib/neon';
import { insuredEmails, coInsuredEmails } from './recipients.service';

/**
 * What the send list promises versus what the push would actually do.
 *
 * ── The gap this exists to close ────────────────────────────────────────────
 * Two pieces of code decide who gets mailed and they were written months apart.
 * buildSendList picks the population, freezes it, and deals the test arms over it.
 * triagePush decides, at send time, who it will actually accept — and it refuses a lead the
 * send list never asked about: holdout-flagged, hard-bounced, unsubscribed, suppressed at
 * household level.
 *
 * Neither is wrong on its own. Nothing errors. The push even reports what it skipped. But
 * the number Frank was given is the send list's, the number that leaves is the push's, and
 * nobody compares them until somebody asks why a week of 850 sent 765.
 *
 * ── Why this matters beyond the count ───────────────────────────────────────
 * The subject line and CTA arms are dealt evenly across the frozen list. Every person the
 * push then refuses leaves a hole in that deal. The arms can be perfectly balanced as dealt
 * and materially unbalanced in what actually sends — which is worse than an obviously uneven
 * split, because the report says "balanced" and means it.
 *
 * On the list as frozen on 24 Sep 2026: balanced to within one person in every week as
 * dealt, and off by as much as eleven in what would send.
 *
 * ── It only reports ─────────────────────────────────────────────────────────
 * Nothing here changes a lead. Which way to resolve a disagreement — clear the flags, or
 * re-cut the list — is a decision about what we promised Frank, and the point of a preflight
 * is to put that decision in front of a person before the send, not to make it for them.
 */

export type PreflightIssue = {
  code: 'holdout_on_list' | 'suppressed_on_list' | 'unreachable_on_list' | 'arms_unbalanced';
  severity: 'blocker' | 'warning';
  /** Written for whoever is about to press send, not for whoever wrote this file. */
  headline: string;
  detail: string;
  count: number;
  byCohort?: Array<{ cohort: string; n: number; note?: string }>;
};

export type Preflight = {
  effFrom: string;
  effTo: string;
  onList: number;
  /** Leads on the list the push would accept. */
  willSend: number;
  /** Leads on the list the push would refuse, by reason. */
  refused: number;
  issues: PreflightIssue[];
  ok: boolean;
};

export async function sendPreflight(params: { effFrom: string; effTo: string }): Promise<Preflight> {
  const { effFrom, effTo } = params;

  /**
   * The same columns the push reads to decide, so this cannot pass a lead the push will
   * refuse. Reading different columns from the thing being checked is how a preflight ends
   * up agreeing with nobody.
   */
  const leads = await sql`
    SELECT "id", "cohort", "holdoutFlag", "hardBounced", "campaignUnsubscribedAt", "campaignStatus",
           "campaignSegment", "insuredSubjectVariant", "insuredCtaArm",
           "coInsuredSubjectVariant", "coInsuredCtaArm",
           "email1", "email2", "owner2Email", "emailsAll", "skipTraceData",
           "owner1FirstName", "owner1LastName", "owner2FirstName", "owner2LastName"
      FROM "Lead"
     WHERE "sendListBuiltAt" IS NOT NULL
       AND "cohort" BETWEEN ${effFrom} AND ${effTo}
     ORDER BY "cohort"` as Array<Record<string, any>>;

  const issues: PreflightIssue[] = [];
  const bucket = (rows: Array<Record<string, any>>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.cohort), (m.get(String(r.cohort)) ?? 0) + 1);
    return [...m].sort().map(([cohort, n]) => ({ cohort, n }));
  };

  /**
   * The holdout only counts as a refusal when it is actually switched on.
   *
   * Read from the same AppConfig key the push reads. A preflight that flagged holdout
   * accounts while the push happily sent them would be the same disagreement it exists to
   * catch, pointing the other way — and it would go on shouting about 85 accounts that are
   * no longer a problem, which is how a check gets ignored.
   */
  const [cfg] = await sql`
    SELECT "value" FROM "AppConfig" WHERE "key" = 'holdout_active'` as Array<{ value: string }>;
  const holdoutActive = String(cfg?.value ?? '').trim().toLowerCase() === 'true';

  const holdout = holdoutActive ? leads.filter((l) => l.holdoutFlag === true) : [];
  const suppressed = leads.filter((l) => !(holdoutActive && l.holdoutFlag === true) && (
    l.hardBounced === true
    || l.campaignUnsubscribedAt != null
    || String(l.campaignStatus ?? '') === 'suppressed'));
  const unreachable = leads.filter((l) =>
    insuredEmails(l).length === 0 && coInsuredEmails(l).length === 0);

  if (holdout.length) {
    issues.push({
      code: 'holdout_on_list',
      // A blocker, not a warning. These accounts were counted in the figure Frank was given
      // and dealt test arms; the push will refuse every one. Whichever way it is resolved,
      // sending in this state means reporting a number that did not happen.
      severity: 'blocker',
      headline: `${holdout.length} accounts on the send list are flagged holdout and the push will refuse them`,
      detail: 'Section 1.9 of the directive says there is no holdout in wave one, but these '
        + 'accounts carry the flag and the push skips any flagged account. They were counted '
        + 'in the send list total and dealt subject and CTA arms, so the list promises more '
        + 'than the send can deliver. Either the flags come off or the list is re-cut — it is '
        + 'a question about what we told Frank, not a bug to patch.',
      count: holdout.length,
      byCohort: bucket(holdout),
    });
  }

  if (suppressed.length) {
    issues.push({
      code: 'suppressed_on_list',
      severity: 'blocker',
      headline: `${suppressed.length} accounts on the send list are suppressed`,
      detail: 'Hard-bounced, unsubscribed, or suppressed at household level. The push refuses '
        + 'them and it is right to — but they are inside the frozen count, so the send total '
        + 'will not match the list.',
      count: suppressed.length,
      byCohort: bucket(suppressed),
    });
  }

  if (unreachable.length) {
    issues.push({
      code: 'unreachable_on_list',
      severity: 'warning',
      headline: `${unreachable.length} accounts on the send list have no email address`,
      detail: 'Nothing to mail. They should not have entered the list at all, so this points '
        + 'at the build rather than at the accounts.',
      count: unreachable.length,
      byCohort: bucket(unreachable),
    });
  }

  /**
   * The balance of what will ACTUALLY send.
   *
   * Recomputed over the accepted population rather than read back from the build, because
   * the build's own balance is a statement about a population that is about to shrink. §3
   * asks for balanced arms so the two comparisons can be read; arms balanced over people who
   * never receive anything answer nothing.
   */
  const refusedIds = new Set([...holdout, ...suppressed, ...unreachable].map((l) => String(l.id)));
  const real = new Map<string, { A: number; B: number; one: number; two: number }>();
  for (const l of leads) {
    if (refusedIds.has(String(l.id))) continue;
    const c = String(l.cohort);
    if (!real.has(c)) real.set(c, { A: 0, B: 0, one: 0, two: 0 });
    const t = real.get(c)!;
    const add = (s: unknown, a: unknown) => {
      if (s === 'A') t.A++; else if (s === 'B') t.B++;
      if (Number(a) === 1) t.one++; else if (Number(a) === 2) t.two++;
    };
    if (insuredEmails(l).length) add(l.insuredSubjectVariant, l.insuredCtaArm);
    if (coInsuredEmails(l).length) add(l.coInsuredSubjectVariant, l.coInsuredCtaArm);
  }

  /**
   * One person's difference is the definition of balanced and is expected. Anything beyond
   * that is a real skew — flagged with the week and the split so it can be judged rather
   * than merely noticed.
   */
  const skewed = [...real]
    .map(([cohort, t]) => ({
      cohort,
      subject: Math.abs(t.A - t.B),
      cta: Math.abs(t.one - t.two),
      note: `subject ${t.A}/${t.B}, CTA ${t.one}/${t.two}`,
    }))
    .filter((x) => x.subject > 1 || x.cta > 1)
    .sort((a, b) => b.subject + b.cta - (a.subject + a.cta));

  if (skewed.length) {
    const worst = Math.max(...skewed.map((s) => Math.max(s.subject, s.cta)));
    issues.push({
      code: 'arms_unbalanced',
      severity: 'blocker',
      headline: `${skewed.length} renewal weeks would send unbalanced test arms — worst gap ${worst} people`,
      detail: 'The arms are balanced across the frozen list, but every account the push '
        + 'refuses leaves a hole in that deal. This is the balance of what would actually go '
        + 'out. Section 3 asks for balanced arms so the subject and CTA comparisons can be '
        + 'read at all; a comparison whose arms differ by this much cannot answer which one '
        + 'won, and the report would still describe itself as balanced.',
      count: skewed.length,
      byCohort: skewed.map((s) => ({ cohort: s.cohort, n: Math.max(s.subject, s.cta), note: s.note })),
    });
  }

  return {
    effFrom,
    effTo,
    onList: leads.length,
    willSend: leads.length - refusedIds.size,
    refused: refusedIds.size,
    issues,
    ok: !issues.some((i) => i.severity === 'blocker'),
  };
}
