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
    description: 'All critical fields present',
    color: '#1b5e20',
    backgroundColor: '#c8e6c9',
    borderColor: '#558b2f',
  },
  B: {
    grade: 'B',
    label: 'Missing 1 Field',
    description: 'Missing one critical field',
    color: '#e65100',
    backgroundColor: '#ffe0b2',
    borderColor: '#ff6d00',
  },
  C: {
    grade: 'C',
    label: 'Missing Multiple',
    description: 'Missing multiple critical fields',
    color: '#c62828',
    backgroundColor: '#ffcdd2',
    borderColor: '#d32f2f',
  },
  D: {
    grade: 'D',
    label: 'Disqualified',
    description: 'Invalid or disqualified',
    color: '#4a148c',
    backgroundColor: '#f3e5f5',
    borderColor: '#7b1fa2',
  },
};
