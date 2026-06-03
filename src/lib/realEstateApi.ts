import { API_CONFIG, PAGINATION } from './constants';
import { Lead, LeadPageFilters } from '@/types/lead';
import { PropertySearchResponse, PropertySearchRequest } from '@/types/api';

/**
 * Real Estate API Client for v2 PropertySearch
 * Routes requests through Next.js backend to avoid CORS issues
 */
class RealEstateApiClient {
  private apiKey: string;
  private userId: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = API_CONFIG.API_KEY;
    this.userId = API_CONFIG.USER_ID;
    this.baseUrl = API_CONFIG.BASE_URL;

    if (!this.apiKey) {
      console.warn(
        'Real Estate API Key not configured. Set NEXT_PUBLIC_REAL_ESTATE_API_KEY in .env.local'
      );
    }
  }

  /**
   * Fetch properties from the Real Estate API PropertySearch endpoint
   * Routes through our Next.js backend to handle CORS
   */
  async getProperties(filters?: LeadPageFilters): Promise<Lead[]> {
    try {
      if (!this.apiKey) {
        throw new Error('API Key not configured');
      }

      const size = filters?.limit || 20;
      const url = new URL('/api/leads', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
      url.searchParams.append('size', size.toString());

      // Call our backend API route instead of directly calling the external API
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend API Error:', response.statusText, errorText);
        throw new Error(`Backend API Error: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data) {
        console.log('📊 Payload sent to Real Estate API:', result.payload);
        return result.data;
      }

      throw new Error(result.error || 'Failed to fetch properties');
    } catch (error) {
      console.error('Error fetching properties:', error);
      throw error;
    }
  }

  /**
   * Search properties with advanced filters
   * Routes through our Next.js backend to handle CORS
   */
  async searchProperties(filters?: LeadPageFilters & Record<string, any>): Promise<PropertySearchResponse> {
    try {
      if (!this.apiKey) {
        throw new Error('API Key not configured');
      }

      const requestBody: PropertySearchRequest = {
        ids_only: filters?.ids_only || false,
        obfuscate: filters?.obfuscate || false,
        summary: filters?.summary || false,
        size: filters?.limit || PAGINATION.DEFAULT_LIMIT,
      };

      console.log('📤 Sending request to backend with payload:', requestBody);

      // Call our backend API route instead of directly calling the external API
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend API Error:', response.statusText, errorText);
        throw new Error(`Backend API Error: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        console.log('📊 Payload sent to Real Estate API:', result.payload);
        console.log('📥 Real Estate API returned', result.data?.length || 0, 'properties');
        return {
          live: true,
          input: requestBody,
          data: result.data || [],
          resultCount: result.data?.length || 0,
          resultIndex: 0,
          recordCount: result.data?.length || 0,
          statusCode: 200,
          statusMessage: 'Success',
          requestExecutionTimeMS: '0',
        };
      }

      throw new Error(result.error || 'Failed to search properties');
    } catch (error) {
      console.error('Error searching properties:', error);
      throw error;
    }
  }

  /**
   * Get a single property by ID
   */
  async getPropertyById(id: string): Promise<Lead> {
    try {
      if (!this.apiKey) {
        throw new Error('API Key not configured');
      }

      // Call our backend API route
      const response = await fetch(`/api/leads?id=${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.data && result.data.length > 0) {
        return result.data[0];
      }

      throw new Error('Property not found');
    } catch (error) {
      console.error('Error fetching property:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const realEstateApi = new RealEstateApiClient();
