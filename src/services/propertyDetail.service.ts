import { API_CONFIG } from '@/lib/constants';

/**
 * REAPI PropertyDetail (v2/PropertyDetail) — the GRANULAR, per-property pull.
 *
 * Consumes ONE REAPI credit per call, so it is only ever run deliberately (currently
 * on new Grade-A single-family leads inside the weekly pull — Frank Aug-2026). The bulk
 * PropertySearch feed does NOT return these fields (bath split, garage type/count,
 * basement finish %, or the mortgage record), which is the whole reason for this call.
 *
 * NB (from the 5-lead test): the detail data is only as good as REAPI has it — bathroom
 * counts can be under-reported and stories often missing. We write faithfully what the
 * API returns; the caller decided that trade-off.
 */
const DETAIL_URL = 'https://api.realestateapi.com/v2/PropertyDetail';

const num = (v: any): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** REAPI garageType strings → our two-value dropdown (Frank: Attached / Detached only). */
function mapGarageType(v: any): 'attached' | 'detached' | undefined {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('attached')) return 'attached';
  if (s.includes('detached')) return 'detached';
  return undefined; // Built-in / Carport / None / blank → leave unset
}

/**
 * Fetch PropertyDetail for one property and map the granular fields we surface.
 * Returns a patch of ONLY the fields that came back, or null on any failure / no data.
 * Never throws — a bad call must not break the weekly pull.
 */
export async function fetchPropertyDetailPatch(propertyId: string): Promise<Record<string, any> | null> {
  if (!API_CONFIG.API_KEY || !propertyId) return null;
  try {
    const res = await fetch(DETAIL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': API_CONFIG.API_KEY,
        'x-user-id': API_CONFIG.USER_ID,
      },
      body: JSON.stringify({ id: propertyId }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;

    const j = await res.json();
    const d = j?.data ?? j ?? {};
    const pi = d.propertyInfo ?? {};
    const cm = Array.isArray(d.currentMortgages) ? d.currentMortgages[0] : null;

    const patch: Record<string, any> = {};

    // Bathrooms — total + half (partial); full = total − half. Written faithfully even
    // when REAPI's count looks incomplete (caller's decision, Aug-2026).
    const total = num(pi.bathrooms);
    const half = num(pi.partialBathrooms);
    if (half !== undefined) patch.bathroomsHalf = half;
    if (total !== undefined && half !== undefined) patch.bathroomsFull = Math.max(total - half, 0);

    if (num(pi.stories) !== undefined) patch.stories = num(pi.stories);

    const gt = mapGarageType(pi.garageType);
    if (gt) patch.garageType = gt;
    if (num(pi.parkingSpaces) !== undefined) patch.garageCount = num(pi.parkingSpaces);

    if (pi.basementFinishedPercent !== null && pi.basementFinishedPercent !== undefined) {
      patch.basementFinishedPct = String(pi.basementFinishedPercent);
    }

    // Original mortgage amount at closing (equity analysis, Frank Aug-2026) — from the
    // current mortgage record, which the bulk pull does not carry.
    if (cm && num(cm.amount) !== undefined) patch.originalMortgageAmount = num(cm.amount);

    return Object.keys(patch).length ? patch : null;
  } catch {
    return null;
  }
}
