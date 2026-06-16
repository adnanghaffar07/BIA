/**
 * Coast Distance Service
 *
 * Calculates the straight-line distance (Haversine) from a property
 * to the nearest point on the New Jersey coastline.
 *
 * Used as a carrier appetite signal:
 *   - Extreme  (< 0.5 mi)  → both carriers require underwriting review
 *   - High     (0.5–2 mi)  → flag for producer awareness
 *   - Moderate (2–5 mi)    → informational note
 *   - Low      (> 5 mi)    → no coastal flag
 *
 * NJ shoreline reference points run from Sandy Hook south to Cape May.
 * Sourced from NOAA coastal boundary data (approximate centroids).
 */

export type CoastExposure = 'extreme' | 'high' | 'moderate' | 'low';

export interface CoastResult {
  distanceMiles: number;
  exposure: CoastExposure;
  nearestPoint: string;
  carrierNote: string | null;
}

// ─── NJ Coastline Reference Points ───────────────────────────────────────────
// Ordered Sandy Hook → Cape May (Atlantic Ocean + Delaware Bay shoreline)
const NJ_COAST_POINTS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Sandy Hook',         lat: 40.4674, lng: -74.0094 },
  { name: 'Sea Bright',         lat: 40.3629, lng: -73.9763 },
  { name: 'Long Branch',        lat: 40.3029, lng: -73.9874 },
  { name: 'Asbury Park',        lat: 40.2232, lng: -74.0122 },
  { name: 'Spring Lake',        lat: 40.1551, lng: -74.0285 },
  { name: 'Point Pleasant Beach',lat: 40.0956, lng: -74.0440 },
  { name: 'Seaside Heights',    lat: 39.9457, lng: -74.0785 },
  { name: 'Island Beach',       lat: 39.8312, lng: -74.1010 },
  { name: 'Ship Bottom (LBI)',  lat: 39.6440, lng: -74.1877 },
  { name: 'Beach Haven (LBI)',  lat: 39.5568, lng: -74.2440 },
  { name: 'Atlantic City',      lat: 39.3643, lng: -74.4229 },
  { name: 'Ocean City',         lat: 39.2776, lng: -74.5746 },
  { name: 'Stone Harbor',       lat: 39.0529, lng: -74.7596 },
  { name: 'Cape May',           lat: 38.9351, lng: -74.9060 },
  { name: 'Wildwood',           lat: 38.9918, lng: -74.8135 },
];

// ─── Haversine formula ────────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate the distance from a lat/lng coordinate to the nearest NJ coastal point.
 * Returns null if coordinates are not provided.
 */
export function calculateCoastDistance(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): CoastResult | null {
  if (!latitude || !longitude) return null;

  let minDist = Infinity;
  let nearest = NJ_COAST_POINTS[0];

  for (const point of NJ_COAST_POINTS) {
    const d = haversineMiles(latitude, longitude, point.lat, point.lng);
    if (d < minDist) {
      minDist = d;
      nearest = point;
    }
  }

  const distanceMiles = Math.round(minDist * 10) / 10;

  let exposure: CoastExposure;
  let carrierNote: string | null = null;

  if (distanceMiles < 0.5) {
    exposure = 'extreme';
    carrierNote = `Extreme coastal exposure — ${distanceMiles} mi from ${nearest.name}. Both carriers require underwriting review; wind/hail deductibles likely apply.`;
  } else if (distanceMiles < 2) {
    exposure = 'high';
    carrierNote = `High coastal exposure — ${distanceMiles} mi from ${nearest.name}. Flag for producer: wind mitigation documentation may be required.`;
  } else if (distanceMiles < 5) {
    exposure = 'moderate';
    carrierNote = `Moderate coastal proximity — ${distanceMiles} mi from ${nearest.name}. Informational; confirm no coastal endorsements required at binding.`;
  } else {
    exposure = 'low';
    carrierNote = null; // No note needed for low exposure
  }

  return { distanceMiles, exposure, nearestPoint: nearest.name, carrierNote };
}

// ─── Coastal appetite (Plymouth Rock NJ AtHome UW Guidelines 4/2026, p.9) ──────
//
// Frank (Jun 2026): "Hurricane / coastal classification — use same as Plymouth Rock."
// So this classifier drives eligibility for BOTH carriers.
//
// Barrier-island ZIP codes are hard-ineligible regardless of measured distance.
export const BARRIER_ISLAND_ZIPS = new Set([
  '07734', '07740', '08006', '08008', '08202', '08203', '08204', '08226', '08243', '08247',
  '08248', '08260', '08401', '08402', '08406', '08735', '08738', '08742', '08751', '08752',
]);

export type HurricaneDeductible = '1%' | '2%' | '5%' | null;

export interface CoastalAppetite {
  eligible: boolean;
  reason: string | null;            // ineligibility reason, when eligible === false
  distanceMiles: number | null;     // null when coordinates unavailable
  hurricaneDeductible: HurricaneDeductible;
  note: string | null;              // informational (e.g. mandatory hurricane deductible)
}

/**
 * Distance-to-coast eligibility + mandatory hurricane deductible, per the Plymouth Rock
 * NJ AtHome UW Guidelines (independent-agent channel — BIA is an independent agency):
 *
 *   Barrier-island ZIP        → ineligible
 *   0 to < 2 mi               → eligible
 *   2 to < 5 mi               → ineligible
 *   5 mi +                    → eligible
 *
 * Mandatory hurricane deductible by distance to coast:
 *   ≤ 2,500 ft (~0.473 mi)    → 5% of Cov A
 *   2,501 ft to < 1 mi        → 2%
 *   1 to 3 mi                 → 1%
 *
 * Note: the one-page Appetite Guide states a simpler "within 3 miles → ineligible"; we follow
 * the detailed AtHome chart's independent-agent column (the 0–2 mi band stays eligible).
 * Missing ZIP/coordinates are NOT penalized — eligibility defaults to true so we never
 * hard-drop on absent data.
 */
export function getCoastalAppetite(
  zip: string | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): CoastalAppetite {
  if (zip && BARRIER_ISLAND_ZIPS.has(zip.trim())) {
    return {
      eligible: false,
      reason: `Barrier-island ZIP ${zip.trim()} — ineligible per Plymouth Rock NJ coastal guidelines`,
      distanceMiles: null,
      hurricaneDeductible: null,
      note: null,
    };
  }

  const coast = calculateCoastDistance(latitude, longitude);
  if (!coast) {
    return { eligible: true, reason: null, distanceMiles: null, hurricaneDeductible: null, note: null };
  }

  const d = coast.distanceMiles;

  // Mandatory hurricane deductible tier (applies whether or not the band is eligible)
  let hurricaneDeductible: HurricaneDeductible = null;
  if (d <= 0.473) hurricaneDeductible = '5%';        // ≤ 2,500 ft
  else if (d < 1) hurricaneDeductible = '2%';        // 2,501 ft to < 1 mi
  else if (d <= 3) hurricaneDeductible = '1%';       // 1 to 3 mi

  // Eligibility band — 2 to < 5 mi is the ineligible zone
  if (d >= 2 && d < 5) {
    return {
      eligible: false,
      reason: `${d} mi from ${coast.nearestPoint} — within the 2–5 mi coastal ineligible band`,
      distanceMiles: d,
      hurricaneDeductible,
      note: null,
    };
  }

  const note = hurricaneDeductible
    ? `Coastal: ${d} mi from ${coast.nearestPoint} — mandatory ${hurricaneDeductible} hurricane deductible applies`
    : null;
  return { eligible: true, reason: null, distanceMiles: d, hurricaneDeductible, note };
}

/**
 * Get a short human-readable label for the UI.
 */
export function getCoastExposureLabel(exposure: CoastExposure | null | undefined): string {
  switch (exposure) {
    case 'extreme':  return '🔴 Extreme';
    case 'high':     return '🟠 High';
    case 'moderate': return '🟡 Moderate';
    case 'low':      return '🟢 Low';
    default:         return '—';
  }
}
