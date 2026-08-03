/**
 * Municipal tax-roll owner lookup (Edmunds GovTech WIPP).
 *
 * Confirms the insured name we hold against the township's public tax roll.
 *
 * ── Scope, deliberately narrow ───────────────────────────────────────────────
 * The public site is a BILL-PAYMENT portal. We use exactly ONE read-only endpoint:
 *
 *     GET /wipp-core/v1/wippUtil/search?propertyLoc=<address>&size=<n>
 *
 * which returns the owner name for an address. We never call the account-detail
 * endpoint, never POST, and never touch anything on a payment path. `assertSafeUrl`
 * enforces that in code rather than by convention, so a future edit can't quietly
 * widen the blast radius.
 *
 * ── Etiquette ────────────────────────────────────────────────────────────────
 * Requests are serialised with a minimum gap between them. This is a small municipal
 * service; we behave like one careful person, not a crawler. Results are cached on the
 * lead (ownerVerify* columns) so a property is never looked up twice.
 *
 * NOTE: automated use of a third-party vendor's portal is a business/ToS decision for
 * BIA to confirm — this module is the mechanism, not the authorisation to run it at
 * volume. It is equally happy being fed a township-supplied data extract instead;
 * `compareOwnerNames` does the actual verification and is source-agnostic.
 */
import { compareOwnerNames, NameComparison } from './ownerNameMatch.service';

const API_ROOT = 'https://api.edmundsgovtech.cloud/wipp-core/v1';

/**
 * Two read-only search endpoints, tried in order.
 *
 * Property tax first: every property pays tax, but not every property has a
 * municipal water/sewer account — plenty of homes are on well and septic, and those
 * are simply absent from the utility roll (verified: "7 American Way, Marlboro" is
 * missing from utility but present on tax). Utility is kept as a fallback because
 * some records appear there and not on tax.
 */
const SEARCH_ENDPOINTS = [
  { kind: 'tax', path: '/wippPropInfo/search', extra: '&noBlqFlag=N' },
  { kind: 'utility', path: '/wippUtil/search', extra: '' },
] as const;

/**
 * ZIP → the municipalities that share it. Add a town by adding one entry (the wippId
 * is in the portal URL; note it is not always numeric — Manalapan's is "WMON").
 *
 * A ZIP is NOT a municipality, so this is a LIST. 07726 posts as "Englishtown" but
 * covers both the tiny Borough of Englishtown and the much larger Manalapan Township,
 * which keep separate tax rolls — and most "Englishtown" addresses are physically in
 * Manalapan (verified: 83 Sunnymede St is on Manalapan's roll, not Englishtown's).
 * Each town is tried in turn, most-likely first; a property that is on none of them
 * is simply left unverified rather than wrongly flagged.
 */
export interface Municipality { wippId: string; town: string }

export const WIPP_BY_ZIP: Record<string, Municipality[]> = {
  '07731': [{ wippId: '1321', town: 'Howell' }],
  '07746': [{ wippId: '1330', town: 'Marlboro' }],
  '07726': [
    { wippId: 'WMON', town: 'Manalapan' },    // ~213 of our 241 leads in this ZIP
    { wippId: '1313', town: 'Englishtown' },  // the borough proper
  ],
  // 07728 covers Freehold Township AND Freehold Borough — separate municipalities,
  // separate rolls (Township 1317, Borough 1316; verified live Jul-2026: "MAIN STREET"
  // returns Borough rows on 1316 and nothing on 1317, since Main St is Borough territory).
  '07728': [
    { wippId: '1317', town: 'Freehold Township' },
    { wippId: '1316', town: 'Freehold Borough' },
  ],
  '07730': [{ wippId: '1318', town: 'Hazlet' }],
  // Middletown publishes property tax only — no utility roll (the fallback handles it).
  '07748': [{ wippId: '1332', town: 'Middletown' }],
  // 07724 splits roughly evenly between Tinton Falls (30) and Eatontown (28).
  // (Eatontown's public link is on the legacy edmundsassoc.com domain, but the same id
  //  works against the modern API — no second integration needed.)
  '07724': [
    { wippId: '1349', town: 'Tinton Falls' },
    { wippId: '1312', town: 'Eatontown' },
  ],
  '07733': [{ wippId: '1320', town: 'Holmdel' }],
  '07722': [{ wippId: '1310', town: 'Colts Neck' }],   // property tax only
  '08701': [{ wippId: '1515', town: 'Lakewood' }],     // Ocean County, property tax only

  // ── Middlesex County (Frank Aug-2026) ───────────────────────────────────────
  // Every id below was read from the town's official tax portal AND confirmed
  // against the live Edmunds API (each returns that town's own roll). Edmunds
  // assigned Middlesex a consecutive block 1201-1225 alphabetically. Dunellen (1203) and
  // Old Bridge (1215) moved their PAYMENTS off Edmunds (Link2Gov / in-house portal), but
  // Dunellen's tax ROLL is still live on the read-only API, so it's wired below; Old
  // Bridge (1215) returns nothing on the API and is left out (its ZIP pulls, no verify).
  // A stale/wrong id can never mis-verify: lookupTaxRoll requires an exact street match,
  // so the worst case is "no match" (same as unverified), never a false tick.
  '07008': [{ wippId: '1201', town: 'Carteret' }],
  '08812': [{ wippId: '1203', town: 'Dunellen' }],     // payments on Link2Gov; roll still on Edmunds API
  '08512': [{ wippId: '1202', town: 'Cranbury' }],
  '08816': [{ wippId: '1204', town: 'East Brunswick' }],
  '08817': [{ wippId: '1205', town: 'Edison' }],
  '08820': [{ wippId: '1205', town: 'Edison' }],
  '08837': [{ wippId: '1205', town: 'Edison' }],
  '08828': [{ wippId: '1206', town: 'Helmetta' }],
  '08904': [{ wippId: '1207', town: 'Highland Park' }],
  // 08831 covers both Jamesburg Borough and the surrounding Monroe Township.
  '08831': [{ wippId: '1212', town: 'Monroe Township' }, { wippId: '1208', town: 'Jamesburg' }],
  '08840': [{ wippId: '1209', town: 'Metuchen' }],
  '08846': [{ wippId: '1210', town: 'Middlesex Borough' }],
  '08850': [{ wippId: '1211', town: 'Milltown' }],
  '08901': [{ wippId: '1213', town: 'New Brunswick' }],
  '08902': [{ wippId: '1214', town: 'North Brunswick' }],
  '08861': [{ wippId: '1216', town: 'Perth Amboy' }],
  '08854': [{ wippId: '1217', town: 'Piscataway' }],
  '08536': [{ wippId: '1218', town: 'Plainsboro' }],
  '08872': [{ wippId: '1219', town: 'Sayreville' }],
  // 08859 (Parlin) is split between Sayreville and Old Bridge; only Sayreville is on Edmunds.
  '08859': [{ wippId: '1219', town: 'Sayreville' }],
  '08879': [{ wippId: '1220', town: 'South Amboy' }],
  '08852': [{ wippId: '1221', town: 'South Brunswick' }],
  '08810': [{ wippId: '1221', town: 'South Brunswick' }],
  '08824': [{ wippId: '1221', town: 'South Brunswick' }],
  '07080': [{ wippId: '1222', town: 'South Plainfield' }],
  '08882': [{ wippId: '1223', town: 'South River' }],
  '08884': [{ wippId: '1224', town: 'Spotswood' }],
  // Woodbridge Township spans many sections/ZIPs; all share wippId 1225.
  '07095': [{ wippId: '1225', town: 'Woodbridge' }],
  '08830': [{ wippId: '1225', town: 'Woodbridge' }],  // Iselin
  '07067': [{ wippId: '1225', town: 'Woodbridge' }],  // Colonia
  '08863': [{ wippId: '1225', town: 'Woodbridge' }],  // Fords
  '07001': [{ wippId: '1225', town: 'Woodbridge' }],  // Avenel
  '07064': [{ wippId: '1225', town: 'Woodbridge' }],  // Port Reading
  '07077': [{ wippId: '1225', town: 'Woodbridge' }],  // Sewaren
  '08832': [{ wippId: '1225', town: 'Woodbridge' }],  // Keasbey
  // Pull only, no WIPP verify: 08857 Old Bridge (in-house SharePoint portal; 1215 empty
  // on the Edmunds API). 08859 (Parlin) is shared Sayreville/Old Bridge — Sayreville side
  // verifies, Old Bridge side won't match and falls through unverified.
};

export interface TaxRollRecord {
  ownerName: string;
  propertyLoc: string;
  accountId: string;
}

export interface OwnerVerification {
  status: NameComparison['result'];
  detail: string;
  /** Name exactly as the tax roll shows it. */
  recordName: string | null;
  source: string;
  checkedAt: Date;
}

// ── Safety rails ────────────────────────────────────────────────────────────

/** Only the two read-only search endpoints are ever permitted. */
function assertSafeUrl(url: string): void {
  const allowed = SEARCH_ENDPOINTS.some((e) => url.startsWith(`${API_ROOT}${e.path}?`));
  if (!allowed) {
    throw new Error(`taxRoll: refusing to call a non-search endpoint (${url.slice(0, 80)})`);
  }
  if (/\b(pay|payment|cart|checkout|charge|card|ach)\b/i.test(url)) {
    throw new Error('taxRoll: refusing to call a payment-related endpoint');
  }
}

// Serialise requests with a minimum gap — one careful person, not a crawler.
const MIN_GAP_MS = 1500;
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next as Promise<T>;
}

// ── Address handling ────────────────────────────────────────────────────────

const STREET_SUFFIX: Record<string, string> = {
  ST: 'STREET', RD: 'ROAD', DR: 'DRIVE', CT: 'COURT', LN: 'LANE', AVE: 'AVENUE', AV: 'AVENUE',
  BLVD: 'BOULEVARD', CIR: 'CIRCLE', TER: 'TERRACE', PL: 'PLACE', PKWY: 'PARKWAY', HWY: 'HIGHWAY',
  SQ: 'SQUARE', TRL: 'TRAIL', WAY: 'WAY',
};

/** Canonical form for comparing two street addresses ("21 Moonlight Way" ≡ "21 MOONLIGHT WAY"). */
export function normalizeStreet(s: unknown): string {
  const base = String(s ?? '').toUpperCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  return base
    .split(' ')
    .map((tok) => STREET_SUFFIX[tok] ?? tok)
    .join(' ')
    .trim();
}

// ── Lookup ──────────────────────────────────────────────────────────────────

/** Trim the fixed-width padding the tax roll returns on every field. */
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Look up a property by street address, trying each municipality that shares the ZIP
 * and each roll (property tax, then utility) until one has it.
 * Returns the matching records plus which town they came from; null if nowhere.
 */
export async function lookupTaxRoll(
  street: string,
  zip: string,
): Promise<{ records: TaxRollRecord[]; municipality: Municipality } | null> {
  const munis = WIPP_BY_ZIP[String(zip ?? '').trim()];
  if (!munis?.length || !String(street ?? '').trim()) return null;
  const want = normalizeStreet(street);

  for (const muni of munis) {
    for (const endpoint of SEARCH_ENDPOINTS) {
      const url = `${API_ROOT}${endpoint.path}?propertyLoc=${encodeURIComponent(street.trim())}${endpoint.extra}&size=50`;
      assertSafeUrl(url);

      let json: any;
      try {
        json = await throttled(async () => {
          const res = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json, text/plain, */*', 'X-Wipp-Id': muni.wippId },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`Tax roll lookup failed (${res.status})`);
          return res.json();
        });
      } catch {
        continue; // try the next roll / town rather than failing the whole lookup
      }

      const rows: any[] = Array.isArray(json) ? json : (json?.content ?? []);
      const hits = rows
        .map((r) => ({ ownerName: clean(r?.ownerName), propertyLoc: clean(r?.propertyLoc), accountId: clean(r?.accountId) }))
        .filter((r) => r.ownerName)
        // The search is fuzzy — only trust records whose address actually matches ours,
        // otherwise we could verify against a neighbouring property.
        .filter((r) => normalizeStreet(r.propertyLoc) === want);

      if (hits.length) return { records: hits, municipality: muni };
    }
  }
  return null;
}

/**
 * Verify one lead's insured name against the tax roll.
 * Returns null when the town isn't supported or the property isn't on the roll —
 * callers should leave the lead unverified rather than record a false negative.
 */
export async function verifyOwnerName(lead: {
  addressStreet?: string | null;
  addressZip?: string | null;
  owner1FirstName?: string | null;
  owner1LastName?: string | null;
}): Promise<OwnerVerification | null> {
  const zip = String(lead.addressZip ?? '').trim();
  if (!WIPP_BY_ZIP[zip]?.length) return null;

  const found = await lookupTaxRoll(String(lead.addressStreet ?? ''), zip);
  if (!found) return null;
  const { records, municipality: muni } = found;

  // Compare against every party on the roll and keep the strongest outcome —
  // a property can legitimately be listed under a spouse or co-owner.
  const rank = { match: 3, partial: 2, mismatch: 1, unknown: 0 } as const;
  let best: NameComparison | null = null;
  let bestRecord = records[0];
  for (const rec of records) {
    const cmp = compareOwnerNames({ first: lead.owner1FirstName, last: lead.owner1LastName }, rec.ownerName);
    if (!best || rank[cmp.result] > rank[best.result]) { best = cmp; bestRecord = rec; }
  }
  if (!best) return null;

  return {
    status: best.result,
    detail: best.detail,
    recordName: bestRecord.ownerName,
    source: `${muni.town.toLowerCase()}_tax_roll`,
    checkedAt: new Date(),
  };
}
