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

/**
 * Producer-selected reason when they change a carrier's eligibility (Frank Jul-2026).
 * Structured so QC can REPORT on trends — "dropdowns for things we can report on,
 * text boxes for nuance". The free-text Detail beside it captures the one-offs.
 *
 * "Prior loss" and "Underwriting capacity" are the two reasons Frank/Ruben actually
 * see in the Travelers portal that our own data can never predict — capturing them
 * here is the only way they become visible.
 */
export interface EligibilityReasonOption {
  value: string;
  label: string;
  /** Pre-fills Detail with the property ZIP — these are territory-driven trends. */
  autoZip?: boolean;
}

export const ELIGIBILITY_REASONS: EligibilityReasonOption[] = [
  { value: 'investor_non_owner_occupied', label: 'Investor / non-owner-occupied' },
  { value: 'prior_loss', label: 'Prior loss' },
  { value: 'underwriting_capacity', label: 'Underwriting capacity', autoZip: true },
  { value: 'fema_flood_adjacent', label: 'FEMA flood-adjacent', autoZip: true },
  { value: 'coastal_ineligible', label: 'Coastal ineligible' },
  { value: 'cov_a_over_appetite', label: 'Dwelling Cov A over appetite' },
  { value: 'roof_age', label: 'Roof age' },
  { value: 'other', label: 'Other' },
];

export function eligibilityReasonLabel(v: string | null | undefined): string {
  if (!v) return '';
  return ELIGIBILITY_REASONS.find((o) => o.value === v)?.label ?? v;
}
