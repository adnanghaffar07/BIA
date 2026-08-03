// API Configuration for Real Estate API v2
export const API_CONFIG = {
  BASE_URL: 'https://api.realestateapi.com/v2',
  API_KEY: process.env.NEXT_PUBLIC_REAL_ESTATE_API_KEY || '',
  USER_ID: process.env.NEXT_PUBLIC_REAL_ESTATE_USER_ID || 'UniqueUserIdentifier',
};

// Pagination
export const PAGINATION = {
  DEFAULT_LIMIT: 100,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
};

// Lead Status Options (Frank Phase 5). Canonical definitions live in
// src/types/lead.ts (LEAD_STATUS_OPTIONS / leadStatusLabel) — kept here for
// any legacy importers.
export const LEAD_STATUS = {
  NEW: 'new',
  RATED: 'rated',
  REFERRAL: 'referral',
  INDICATIVE_SENT: 'indicative_sent',
  POS_RAN: 'pos_ran',
  QUOTE_ISSUED: 'quote_issued',
  BOUND: 'bound',
  LOST: 'lost',
};

export const LEAD_STATUS_OPTIONS = [
  { value: LEAD_STATUS.NEW, label: 'New', color: 'info' },
  { value: LEAD_STATUS.RATED, label: 'Rated', color: 'secondary' },
  { value: LEAD_STATUS.REFERRAL, label: 'Referral', color: 'warning' },
  { value: LEAD_STATUS.INDICATIVE_SENT, label: 'Indicative Pricing Sent', color: 'warning' },
  { value: LEAD_STATUS.POS_RAN, label: 'POS Ran', color: 'warning' },
  { value: LEAD_STATUS.QUOTE_ISSUED, label: 'Quote Issued', color: 'primary' },
  { value: LEAD_STATUS.BOUND, label: 'Bound', color: 'success' },
  { value: LEAD_STATUS.LOST, label: 'Lost', color: 'error' },
];

// Property Types from Real Estate API
export const PROPERTY_TYPES = [
  'MFR', // Multi-Family Residential
  'SFR', // Single Family Residential
  'COM', // Commercial
  'IND', // Industrial
  'VAC', // Vacant Land
  'APT', // Apartment
  'MUL', // Multi-Use
];

export const PROPERTY_TYPE_LABELS: Record<string, string> = {
  'MFR': 'Multi-Family Residential',
  'SFR': 'Single Family Residential',
  'COM': 'Commercial',
  'IND': 'Industrial',
  'VAC': 'Vacant Land',
  'APT': 'Apartment',
  'MUL': 'Multi-Use',
};

// Land Use Categories
export const LAND_USE_TYPES = [
  'Residential',
  'Commercial',
  'Industrial',
  'Vacant Land',
  'Agricultural',
  'Multi-Use',
];

// Bedrooms Filter Options
export const BEDROOM_OPTIONS = [
  { label: '1+', value: 1 },
  { label: '2+', value: 2 },
  { label: '3+', value: 3 },
  { label: '4+', value: 4 },
  { label: '5+', value: 5 },
];

// Bathrooms Filter Options
export const BATHROOM_OPTIONS = [
  { label: '1+', value: 1 },
  { label: '2+', value: 2 },
  { label: '3+', value: 3 },
  { label: '4+', value: 4 },
];

// Table Columns for Property Display
export const LEAD_TABLE_COLUMNS = [
  { id: 'address', label: 'Address', minWidth: 200 },
  { id: 'city', label: 'City/State', minWidth: 130 },
  { id: 'propertyType', label: 'Property Type', minWidth: 130 },
  { id: 'bedrooms', label: 'Beds', minWidth: 80 },
  { id: 'bathrooms', label: 'Baths', minWidth: 80 },
  { id: 'squareFeet', label: 'Sq Ft', minWidth: 100 },
  { id: 'estimatedValue', label: 'Est. Value', minWidth: 120 },
  { id: 'status', label: 'Status', minWidth: 100 },
  { id: 'actions', label: 'Actions', minWidth: 100 },
];

// API Endpoints
export const API_ENDPOINTS = {
  PROPERTY_SEARCH: '/PropertySearch',
};

// Error Messages
export const ERROR_MESSAGES = {
  FETCH_LEADS_FAILED: 'Failed to fetch properties. Please try again.',
  CREATE_LEAD_FAILED: 'Failed to create property record. Please try again.',
  UPDATE_LEAD_FAILED: 'Failed to update property record. Please try again.',
  DELETE_LEAD_FAILED: 'Failed to delete property record. Please try again.',
  INVALID_INPUT: 'Please check your input and try again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  INVALID_API_KEY: 'Invalid API configuration. Please check your .env.local file.',
};

// Success Messages
export const SUCCESS_MESSAGES = {
  LEADS_FETCHED: 'Properties fetched successfully',
  LEAD_CREATED: 'Property record created successfully',
  LEAD_UPDATED: 'Property record updated successfully',
  LEAD_DELETED: 'Property record deleted successfully',
};

// ─── REAPI PropertySearch — permanent sourcing filters ───────────────────────
//
// ONE definition, imported by every caller (weekly pull, manual pull, seed). These
// were previously copy-pasted in four places, which is how a filter silently applies
// on one pull path and not another.
//
// Verified free against PropertySearch with `count:true` / `ids_only:true` on a
// representative week (96 candidates) — REAPI honours each of these:
//   absentee_owner:false  −11%   corporate_owned:false −16%
//   investor_buyer:false  −11%   owner_occupied:true   −25%   year_built_min −7%
//
// We exclude absentee/corporate-owned at SOURCE so we stop paying to pull leads we
// then quarantine (Frank, Jul-2026: "we're spending money on these"). We deliberately
// do NOT send owner_occupied:true — it is the blunt one, and REAPI's occupancy flag is
// sometimes wrong (it wrongly flagged owner-occupied homes as investor, e.g. Anurag
// Chadha). Filtering on it at source means such leads never arrive and the error can
// never be caught. absentee_owner is the narrower, safer cut.
export const REAPI_TARGET_ZIPS = [
  // ── Monmouth County — original footprint ──────────────────────────────────
  '07722', '07724', '07726', '07728', '07730',
  '07731', '07733', '07746', '07748', '08701',
  // ── Middlesex County — Frank Aug-2026 expansion (Travelers + Plymouth Rock) ─
  // All 25 municipalities. WIPP owner-name verification is wired for 23 of them
  // (see WIPP_BY_ZIP in taxRoll.service); Dunellen (Link2Gov) and Old Bridge
  // (in-house portal) are NOT on Edmunds, so they pull but do not verify.
  // NOTE: this is a large geography jump — run the weekly-pull Preview (free) to
  // see exact credit cost before the first real pull.
  '07001', '07008', '07064', '07067', '07077', '07080', '07095',
  '08512', '08536', '08810', '08812', '08816', '08817', '08820',
  '08824', '08828', '08830', '08831', '08832', '08837', '08840',
  '08846', '08850', '08852', '08854', '08857', '08859', '08861',
  '08863', '08872', '08879', '08882', '08884', '08901', '08902', '08904',
];

export const REAPI_BASE_FILTERS = {
  state: 'NJ',
  flood_zone: false,
  vacant: false,
  pre_foreclosure: false,
  foreclosure: false,
  reo: false,
  // Sourcing-level appetite exclusions — save credits on leads we would quarantine.
  absentee_owner: false,
  corporate_owned: false,
} as const;
