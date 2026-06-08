export type EligibilityStatus = 'eligible' | 'ineligible' | 'review';

export interface CarrierRuleResult {
  status: EligibilityStatus;
  notes: string[];
}

export interface CarrierEligibilityResult {
  travelers: CarrierRuleResult;
  plymouthRock: CarrierRuleResult;
  passesAnyCarrier: boolean;
}
