import { Lead } from './lead';
import { LeadGrade } from './grade';

/**
 * Critical fields that must be present for a lead to be quoted
 */
const CRITICAL_FIELDS = [
  'owner1LastName',
  'address.street',
  'address.city',
  'address.state',
  'address.zip',
  'lastSaleAmount',
  'estimatedValue',
];

/**
 * Evaluate the completeness of a lead and assign a grade
 * A = All critical fields present (Quote Ready)
 * B = Missing 1 critical field
 * C = Missing 2+ critical fields
 * D = Invalid or disqualified
 */
export function calculateLeadGrade(lead: Lead): LeadGrade {
  // Check if lead is disqualified (basic validation)
  if (!lead || !lead.id || !lead.propertyId) {
    return 'D';
  }

  // Check property type filter (should be residential for insurance)
  if (lead.propertyUse && !['Residential', 'Single Family'].includes(lead.propertyUse)) {
    return 'D';
  }

  // Count missing critical fields
  let missingFieldsCount = 0;

  for (const field of CRITICAL_FIELDS) {
    const value = getNestedValue(lead, field);
    if (!value) {
      missingFieldsCount++;
    }
  }

  // Assign grade based on missing fields
  if (missingFieldsCount === 0) {
    return 'A'; // Quote Ready
  } else if (missingFieldsCount === 1) {
    return 'B'; // Missing 1 field
  } else if (missingFieldsCount <= 3) {
    return 'C'; // Missing multiple fields
  } else {
    return 'D'; // Too many missing fields - disqualified
  }
}

/**
 * Get nested object value using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
}

/**
 * Get missing critical fields for a lead
 */
export function getMissingFields(lead: Lead): string[] {
  const missing: string[] = [];

  for (const field of CRITICAL_FIELDS) {
    const value = getNestedValue(lead, field);
    if (!value) {
      missing.push(field);
    }
  }

  return missing;
}

/**
 * Calculate percentage of complete fields
 */
export function getCompletenessPercentage(lead: Lead): number {
  const totalFields = CRITICAL_FIELDS.length;
  const missingCount = getMissingFields(lead).length;
  const completedCount = totalFields - missingCount;
  return Math.round((completedCount / totalFields) * 100);
}
