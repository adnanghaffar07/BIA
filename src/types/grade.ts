// Lead Grade Types
export type LeadGrade = 'A' | 'B' | 'C' | 'D';

export interface LeadGradeInfo {
  grade: LeadGrade;
  label: string;
  description: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
}

export const GRADE_INFO: Record<LeadGrade, LeadGradeInfo> = {
  A: {
    grade: 'A',
    label: 'Quote Ready',
    description: 'Passes carrier appetite — all critical fields present',
    color: '#1b5e20',
    backgroundColor: '#c8e6c9',
    borderColor: '#558b2f',
  },
  B: {
    grade: 'B',
    label: 'Almost Ready',
    description: 'Passes carrier appetite — missing 1–2 critical fields',
    color: '#e65100',
    backgroundColor: '#ffe0b2',
    borderColor: '#ff6d00',
  },
  C: {
    grade: 'C',
    label: 'Needs Information',
    description: 'Passes carrier appetite — missing 3+ critical fields',
    color: '#c62828',
    backgroundColor: '#ffcdd2',
    borderColor: '#d32f2f',
  },
  D: {
    grade: 'D',
    label: 'Disqualified',
    description: 'Fails all carrier appetite rules or property is ineligible',
    color: '#757575',
    backgroundColor: '#f5f5f5',
    borderColor: '#9e9e9e',
  },
};
