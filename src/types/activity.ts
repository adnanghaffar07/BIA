export type ActivityType =
  | 'note'
  | 'call'
  | 'email'
  | 'status_change'
  | 'skip_trace'
  | 'quote'
  | 'bind'
  | 'grade_change'
  | 'carrier_check';

export interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  content: string;
  metadata?: Record<string, any>;
  createdBy?: string;
  createdAt: string;
}
