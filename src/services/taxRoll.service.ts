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

/** Municipality → WIPP id. Add a town by adding one line (find its wippId in the portal URL). */
export const WIPP_BY_ZIP: Record<string, { wippId: string; town: string }> = {
  '07731': { wippId: '1321', town: 'Howell' },
  '07746': { wippId: '1330', town: 'Marlboro' },
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
 * Look up a property on the municipal tax roll by street address.
 * Returns every record whose address matches; [] when the town isn't wired up.
 */
export async function lookupTaxRoll(street: string, zip: string): Promise<TaxRollRecord[]> {
  const muni = WIPP_BY_ZIP[String(zip ?? '').trim()];
  if (!muni || !String(street ?? '').trim()) return [];
  const want = normalizeStreet(street);

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
      continue; // try the other roll rather than failing the whole lookup
    }

    const rows: any[] = Array.isArray(json) ? json : (json?.content ?? []);
    const hits = rows
      .map((r) => ({ ownerName: clean(r?.ownerName), propertyLoc: clean(r?.propertyLoc), accountId: clean(r?.accountId) }))
      .filter((r) => r.ownerName)
      // The search is fuzzy — only trust records whose address actually matches ours,
      // otherwise we could verify against a neighbouring property.
      .filter((r) => normalizeStreet(r.propertyLoc) === want);

    if (hits.length) return hits;
  }
  return [];
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
  const muni = WIPP_BY_ZIP[zip];
  if (!muni) return null;

  const records = await lookupTaxRoll(String(lead.addressStreet ?? ''), zip);
  if (!records.length) return null;

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
