import { LeadGrade } from '@/types/grade';

/**
 * FEMA flood-zone lookup via the National Flood Hazard Layer (NFHL).
 *
 * Free, no-key ArcGIS REST service. We query layer 28 (S_FLD_HAZ_AR — flood
 * hazard zones) by the lead's lat/long and read back the official FEMA zone.
 * This is the authoritative flood source (Frank, Jun-2026), replacing the
 * unreliable REAPI flood field. A producer can still manually override.
 */
const NFHL_QUERY_URL =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

export interface FemaFloodResult {
  zone: string | null;      // FLD_ZONE — e.g. 'AE', 'VE', 'X'
  subtype: string | null;   // ZONE_SUBTY — e.g. '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'
  sfha: boolean;            // SFHA_TF — true = Special Flood Hazard Area (high-risk)
}

/** Query FEMA NFHL for the flood zone at a point. Returns null on any failure. */
export async function getFemaFloodZone(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): Promise<FemaFloodResult | null> {
  const lat = typeof latitude === 'string' ? parseFloat(latitude) : latitude;
  const lon = typeof longitude === 'string' ? parseFloat(longitude) : longitude;
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const url = new URL(NFHL_QUERY_URL);
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'FLD_ZONE,ZONE_SUBTY,SFHA_TF');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json?.error) return null;

    const attr = json?.features?.[0]?.attributes;
    if (!attr) {
      // No intersecting flood polygon → outside mapped hazard areas = minimal risk.
      return { zone: 'X', subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false };
    }
    return {
      zone: attr.FLD_ZONE ?? null,
      subtype: attr.ZONE_SUBTY ?? null,
      sfha: String(attr.SFHA_TF).toUpperCase() === 'T',
    };
  } catch {
    return null; // network/timeout — never break enrichment
  }
}

/**
 * Map a FEMA result to the worst grade a lead may hold from flood alone
 * (Frank, Jun-2026):
 *   • SFHA ("blue" A/AE/AH/AO/AR, V/VE) → 'D'
 *   • Shaded Zone X ("orange", 0.2% annual chance) → 'C'
 *   • Minimal/unmapped X → no cap (null)
 */
export function floodGradeFromFema(r: FemaFloodResult | null): LeadGrade | null {
  if (!r) return null;
  if (r.sfha) return 'D';
  if ((r.zone ?? '').toUpperCase() === 'X' && /0\.2\s*PCT/i.test(r.subtype ?? '')) return 'C';
  return null;
}
