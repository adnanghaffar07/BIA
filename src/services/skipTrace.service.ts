import { API_CONFIG } from '@/lib/constants';
import type { Lead } from '@/types/lead';

/**
 * REAPI Skip Trace (RealEstateAPI.com add-on) — v2/SkipTrace.
 * Consumes REAPI credits — callers must gate with canRunSkipTrace() first.
 */
const SKIPTRACE_URL = 'https://api.realestateapi.com/v2/SkipTrace';

export interface SkipTraceResult {
  phones: string[];
  emails: string[];
  matched: boolean;
  raw?: unknown;
}

/**
 * Pull phone/email arrays out of REAPI's v2 SkipTrace response.
 * Matches sit under `persons[]`, each with `phones[{phone,…}]` and `emails[string]`.
 */
function extractContacts(json: any): { phones: string[]; emails: string[] } {
  const persons: any[] = Array.isArray(json?.persons) ? json.persons : [];
  const phones: string[] = [];
  const emails: string[] = [];

  for (const person of persons) {
    for (const ph of Array.isArray(person?.phones) ? person.phones : []) {
      const n = typeof ph === 'string' ? ph : ph?.phone;
      if (n) phones.push(String(n));
    }
    for (const em of Array.isArray(person?.emails) ? person.emails : []) {
      const e = typeof em === 'string' ? em : em?.email;
      if (e) emails.push(String(e));
    }
  }

  return { phones: [...new Set(phones)], emails: [...new Set(emails)] };
}

/**
 * Map skip-trace persons ("people on loan") onto the lead's Insured Info, filling
 * EMPTY slots only (never clobber producer entries). Picks the co-insured as the
 * matched person sharing the owner's surname (spouse / co-borrower), else the next
 * distinct person. REAPI returns `age`, not a date of birth, so DOB is an estimated
 * birth year (Jan 1) the producer can refine.
 */
export function insuredPatchFromPersons(persons: any[], lead: any): Record<string, any> {
  const list = Array.isArray(persons) ? persons : [];
  if (!list.length) return {};
  const norm = (s: any) => String(s ?? '').toLowerCase().trim();
  const o1First = norm(lead.owner1FirstName);
  const o1Last = norm(lead.owner1LastName);

  // Frank Jun-2026: the REAPI DOB must come from the skip-traced person whose name
  // matches the Insured Name — never a random person on the loan. Prefer an exact
  // first+last match; the fallback only accepts a same-surname person whose first
  // name is a prefix of the other (≥3 chars), so "Alla"↔"Allan" matches but a
  // same-surname relative like "Al"↔"Albert" does not.
  const firstNamesAgree = (a: string, b: string) => {
    if (!a || !b) return false;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return s.length >= 3 && l.startsWith(s);
  };
  const nameMatch =
    (o1First && o1Last && list.find((p) => norm(p.firstName) === o1First && norm(p.lastName) === o1Last))
    || (o1Last && o1First && list.find((p) => norm(p.lastName) === o1Last && firstNamesAgree(norm(p.firstName), o1First)))
    || null;

  const primary = nameMatch ?? list[0];
  const coInsured =
    list.find((p) => p !== primary && o1Last && norm(p.lastName) === o1Last)
    ?? list.find((p) => p !== primary);

  // REAPI returns `age`, not a birth date. Year is exact (this year − age); month
  // and day are assumed (Jan 1) and flagged "(est.)" for the producer to confirm.
  const estDob = (age: any): string | undefined => {
    const a = parseInt(String(age), 10);
    return a > 0 && a < 120 ? `${new Date().getFullYear() - a}-01-01` : undefined;
  };

  const patch: Record<string, any> = {};

  // REAPI DOB — strictly from the name-matched insured (read-only display field).
  if (nameMatch?.age != null) {
    const a = parseInt(String(nameMatch.age), 10);
    const d = estDob(nameMatch.age);
    if (d) { patch.reapiDob = d; patch.reapiAge = a; }
  }

  if (coInsured) {
    if (!lead.owner2FirstName && coInsured.firstName) patch.owner2FirstName = coInsured.firstName;
    if (!lead.owner2LastName && coInsured.lastName) patch.owner2LastName = coInsured.lastName;
  }
  // Pre-fill the editable DOB fields (empty slots only) so the producer has a
  // starting point to confirm; reapiDob above stays the source-of-truth.
  if (!lead.owner1Dob && primary?.age) { const d = estDob(primary.age); if (d) patch.owner1Dob = d; }
  if (!lead.owner2Dob && coInsured?.age) { const d = estDob(coInsured.age); if (d) patch.owner2Dob = d; }
  return patch;
}

/**
 * Run a skip trace for a single lead against the owner name + property address.
 * Returns de-duplicated phones/emails; throws on transport / auth errors.
 */
export async function runSkipTrace(lead: Lead): Promise<SkipTraceResult> {
  if (!API_CONFIG.API_KEY) {
    throw new Error('REAPI key not configured (NEXT_PUBLIC_REAL_ESTATE_API_KEY).');
  }

  const l = lead as any;
  // Property address is required; mailing address (if present) sharpens the match
  // for absentee owners. REAPI rejects empty-string params, so only send non-empty.
  const candidate: Record<string, unknown> = {
    first_name: l.owner1FirstName,
    last_name: l.owner1LastName,
    address: l.addressStreet,
    city: l.addressCity,
    state: l.addressState,
    zip: l.addressZip,
    mail_address: l.mailStreet,
    mail_city: l.mailCity,
    mail_state: l.mailState,
    mail_zip: l.mailZip,
  };
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidate)) {
    const s = v == null ? '' : String(v).trim();
    if (s) body[k] = s;
  }

  const res = await fetch(SKIPTRACE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_CONFIG.API_KEY,
      'x-user-id': API_CONFIG.USER_ID,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`REAPI SkipTrace ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const { phones, emails } = extractContacts(json);
  const matched = json?.match === true || (json?.resultCount ?? 0) > 0
    || (Array.isArray(json?.persons) && json.persons.length > 0)
    || phones.length > 0 || emails.length > 0;

  return { phones, emails, matched, raw: json };
}
