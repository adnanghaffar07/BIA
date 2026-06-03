import { realEstateApi } from '@/lib/realEstateApi';
import { Lead, LeadPageFilters } from '@/types/lead';
import { PAGINATION } from '@/lib/constants';

/**
 * Lead/Property Service
 * Handles all property-related business logic and API interactions
 */

class LeadService {
  /**
   * Get all properties with optional pagination and filters
   */
  static async getLeads(filters?: LeadPageFilters): Promise<Lead[]> {
    try {
      const properties = await realEstateApi.getProperties(filters);
      return properties;
    } catch (error) {
      console.error('LeadService: Error fetching properties', error);
      throw error;
    }
  }

  /**
   * Search properties with advanced filters
   */
  static async searchProperties(
    filters?: LeadPageFilters & Record<string, any>
  ): Promise<Lead[]> {
    try {
      const response = await realEstateApi.searchProperties(filters || {});
      return response.data || [];
    } catch (error) {
      console.error('LeadService: Error searching properties', error);
      throw error;
    }
  }

  /**
   * Get a single property by ID
   */
  static async getLeadById(id: string): Promise<Lead> {
    try {
      const property = await realEstateApi.getPropertyById(id);
      return property;
    } catch (error) {
      console.error('LeadService: Error fetching property', error);
      throw error;
    }
  }

  /**
   * Format property data for display
   */
  static formatPropertyForDisplay(property: Lead): Lead {
    return {
      ...property,
    };
  }

  /**
   * Filter properties by condition
   */
  static filterProperties(
    properties: Lead[],
    filterFn: (property: Lead) => boolean
  ): Lead[] {
    return properties.filter(filterFn);
  }

  /**
   * Filter properties by investor buyer flag
   */
  static filterInvestorProperties(properties: Lead[]): Lead[] {
    return this.filterProperties(
      properties,
      (prop) => prop.investorBuyer === true
    );
  }

  /**
   * Filter properties with high equity
   */
  static filterHighEquityProperties(properties: Lead[]): Lead[] {
    return this.filterProperties(
      properties,
      (prop) => prop.highEquity === true
    );
  }

  /**
   * Filter properties in pre-foreclosure
   */
  static filterPreForeclosureProperties(properties: Lead[]): Lead[] {
    return this.filterProperties(
      properties,
      (prop) => prop.preForeclosure === true
    );
  }

  /**
   * Filter properties by minimum bedrooms
   */
  static filterByMinBedrooms(
    properties: Lead[],
    minBedrooms: number
  ): Lead[] {
    return this.filterProperties(
      properties,
      (prop) => (prop.bedrooms || 0) >= minBedrooms
    );
  }

  /**
   * Filter properties by minimum bathrooms
   */
  static filterByMinBathrooms(
    properties: Lead[],
    minBathrooms: number
  ): Lead[] {
    return this.filterProperties(
      properties,
      (prop) => (prop.bathrooms || 0) >= minBathrooms
    );
  }

  /**
   * Filter properties by value range
   */
  static filterByValueRange(
    properties: Lead[],
    minValue?: number,
    maxValue?: number
  ): Lead[] {
    return this.filterProperties(properties, (prop) => {
      const value = prop.estimatedValue || 0;
      if (minValue && value < minValue) return false;
      if (maxValue && value > maxValue) return false;
      return true;
    });
  }

  /**
   * Sort properties by field
   */
  static sortProperties(
    properties: Lead[],
    field: keyof Lead,
    order: 'asc' | 'desc' = 'asc'
  ): Lead[] {
    return [...properties].sort((a, b) => {
      const valueA = a[field];
      const valueB = b[field];

      if (valueA === undefined || valueB === undefined) {
        return 0;
      }

      if (valueA < valueB) return order === 'asc' ? -1 : 1;
      if (valueA > valueB) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * Search properties by keyword in address
   */
  static searchByAddress(
    properties: Lead[],
    query: string
  ): Lead[] {
    const lowercaseQuery = query.toLowerCase();
    return properties.filter((prop) => {
      const address = prop.address?.address?.toLowerCase() || '';
      const city = prop.address?.city?.toLowerCase() || '';
      const county = prop.address?.county?.toLowerCase() || '';
      const zip = prop.address?.zip?.toLowerCase() || '';

      return (
        address.includes(lowercaseQuery) ||
        city.includes(lowercaseQuery) ||
        county.includes(lowercaseQuery) ||
        zip.includes(lowercaseQuery)
      );
    });
  }

  /**
   * Get unique property types from array
   */
  static getUniquePropertyTypes(properties: Lead[]): string[] {
    const types = new Set<string>();
    properties.forEach((prop) => {
      if (prop.propertyType) {
        types.add(prop.propertyType);
      }
    });
    return Array.from(types).sort();
  }

  /**
   * Get statistics about properties
   */
  static getPropertyStatistics(properties: Lead[]) {
    if (properties.length === 0) {
      return {
        totalCount: 0,
        averageValue: 0,
        averageBedrooms: 0,
        averageBathrooms: 0,
        highEquityCount: 0,
        investorPropertiesCount: 0,
      };
    }

    const totalValue = properties.reduce((sum, prop) => sum + (prop.estimatedValue || 0), 0);
    const totalBedrooms = properties.reduce((sum, prop) => sum + (prop.bedrooms || 0), 0);
    const totalBathrooms = properties.reduce((sum, prop) => sum + (prop.bathrooms || 0), 0);
    const highEquityCount = properties.filter((prop) => prop.highEquity).length;
    const investorCount = properties.filter((prop) => prop.investorBuyer).length;

    return {
      totalCount: properties.length,
      averageValue: Math.round(totalValue / properties.length),
      averageBedrooms: (totalBedrooms / properties.length).toFixed(1),
      averageBathrooms: (totalBathrooms / properties.length).toFixed(1),
      highEquityCount,
      investorPropertiesCount: investorCount,
    };
  }
}

export default LeadService;
