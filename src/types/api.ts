import { Lead } from './lead';

// Real Estate API v2 Response Structure
export interface PropertySearchRequest {
  ids_only?: boolean;
  obfuscate?: boolean;
  summary?: boolean;
  size?: number;
  [key: string]: any; // Allow additional filters
}

export interface PropertySearchResponse {
  live: boolean;
  input: PropertySearchRequest;
  data: Lead[];
  resultCount: number;
  resultIndex: number;
  recordCount: number;
  statusCode: number;
  statusMessage: string;
  requestExecutionTimeMS: string;
}

// Generic API Response for internal use
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface LeadsApiResponse extends ApiResponse {
  data: Lead[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export interface RealEstateApiConfig {
  apiKey: string;
  userId: string;
  baseUrl: string;
}
