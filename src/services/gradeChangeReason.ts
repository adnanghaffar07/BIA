/**
 * What a grade change was actually FOR (register A31/A33).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Frank, 17 Sep 2026: "we only want to batch the Ds that were manually downgraded because
 * of this reason, not referrals."
 *
 * Every downgrade lands in one list today, so "how many did we lose because the trace
 * came back empty" cannot be separated from "how many are owned by a trust" or "how many
 * no carrier will write". Those are different problems: the first is recoverable by
 * running a better trace, and the other two are not. Batching all of them would spend
 * credits re-tracing leads that were never a contact-data problem.
 *
 * The reason is free text — producers typed it, and the same reason appears as "Trace
 * pulled no contact info nor DOB", "Trace did not pull DOB" and "Skip Trace pulled no
 * contact info nor DOB". Patterns are matched against the wording actually present in the
 * log rather than a vocabulary invented here; the counts each one matches are checked in
 * scripts, not assumed.
 */

export type GradeChangeCategory =
  | 'no_contact'   // the trace returned no contact details and/or no DOB — RECOVERABLE
  | 'trust'        // owned by a trust / LLC / township — not a person to mail
  | 'appetite'     // no carrier will write it (flood, UW guidelines, ineligible)
  | 'occupancy'    // non-owner occupied
  | 'condo_fix'    // condo home-characteristic fields that do not apply
  | 'system'       // the rules re-graded it, not a person
  | 'other';

export const CATEGORY_LABEL: Record<GradeChangeCategory, string> = {
  no_contact: 'No contact info / DOB',
  trust: 'Trust / LLC / township',
  appetite: 'Carrier appetite',
  occupancy: 'Non-owner occupied',
  condo_fix: 'Condo characteristics',
  system: 'System regrade',
  other: 'Other / unclassified',
};

/**
 * The only category that is worth re-tracing. Everything else stays downgraded no matter
 * how good the skip trace gets.
 */
export const RECOVERABLE: GradeChangeCategory = 'no_contact';

export function classifyGradeChange(
  reason: string | null | undefined,
  source?: string | null,
): GradeChangeCategory {
  if (source === 'system') return 'system';
  const s = String(reason ?? '').toLowerCase();
  if (!s.trim()) return 'other';

  // Checked before the rest: a reason can mention both a trace and a trust, and the
  // trace is what decides whether re-running it could help.
  const mentionsTrace = /\b(skip.?trace|trace)\b/.test(s);
  const mentionsMissing = /\b(no|not|did ?n[o']?t|without|missing)\b/.test(s);
  const mentionsContact = /(contact info|contact information|dob|date of birth|phone|email)/.test(s);
  if (mentionsTrace && mentionsMissing && mentionsContact) return 'no_contact';

  // "Under Family Trust", "Under Township", "Under DSA", "Under County Name", "Under Real
  // Estate" — producers write ownership-entity reasons as "Under <whatever>", and the
  // tail is not a fixed vocabulary, so the prefix is what identifies them.
  if (/^under\s+\S/.test(s.trim())) return 'trust';
  if (/(trust|llc|township|company name|corporation|estate of)/.test(s)) return 'trust';
  if (/(not eligible|ineligible|appetite|flood|uw guideline|underwriting|mail in quote)/.test(s)) return 'appetite';
  if (/(owner occupied|non-?owner|tenant occupied)/.test(s)) return 'occupancy';
  if (/condo/.test(s)) return 'condo_fix';
  return 'other';
}
