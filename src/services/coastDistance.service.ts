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
