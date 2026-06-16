export type EligibilityStatus = 'eligible' | 'ineligible' | 'review';

// Explicit appetite verdict + structured reason codes (2026-06 config-driven refactor).
// `status` is retained as the legacy field (derived from `verdict`) so existing consumers,
// stored DB values, and filters keep working without a migration.
export type Verdict = 'PASS' | 'REFER' | 'FAIL';

export interface RuleHit {
  code: string;                 // structured reason code, e.g. 'TR-II-Y', 'PR-AGE-SFD', 'COAST'
  severity: 'FAIL' | 'REFER';
  message: string;
}

export interface CarrierRuleResult {
  status: EligibilityStatus;    // legacy: FAIL→ineligible, REFER→review, PASS→eligible
  verdict: Verdict;
  notes: string[];              // legacy free-text (derived from reasons + informational notes)
  reasons: RuleHit[];           // structured FAIL/REFER reason codes that tripped
}

export interface CarrierEligibilityResult {
  travelers: CarrierRuleResult;
  plymouthRock: CarrierRuleResult;
  passesAnyCarrier: boolean;
}

/** Map the new PASS/REFER/FAIL verdict to the legacy eligible/review/ineligible status. */
export function statusFromVerdict(verdict: Verdict): EligibilityStatus {
  return verdict === 'FAIL' ? 'ineligible' : verdict === 'REFER' ? 'review' : 'eligible';
}
