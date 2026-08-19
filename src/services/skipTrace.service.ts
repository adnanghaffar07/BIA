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

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

/**
 * The skip-trace person whose name matches the INSURED (owner1). Exact first+last,
 * else same-surname with a first-name prefix agreement (≥3 chars) so "Alla"↔"Allan"
 * matches but a same-surname relative like "Al"↔"Albert" does not. Never guesses.
 */
export function matchInsuredPerson(persons: any[], lead: any): any | null {
  const list = Array.isArray(persons) ? persons : [];
  const o1First = norm(lead.owner1FirstName);
  const o1Last = norm(lead.owner1LastName);
  const firstNamesAgree = (a: string, b: string) => {
    if (!a || !b) return false;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    return s.length >= 3 && l.startsWith(s);
  };
  return (o1First && o1Last && list.find((p) => norm(p.firstName) === o1First && norm(p.lastName) === o1Last))
    || (o1Last && o1First && list.find((p) => norm(p.lastName) === o1Last && firstNamesAgree(norm(p.firstName), o1First)))
    || null;
}

const personStreet = (p: any) => norm(p?.address?.streetAddress || p?.address?.address);

/**
 * Co-insured = the spouse / co-owner — NOT an adult child or a stranger on the loan
 * (Frank/Ruben Jul-2026). Preference order:
 *   1. same property address as the insured AND age within 15 yrs  (spouse, co-resident)
 *   2. same property address (any age)
 *   3. same surname AND age within 15 yrs                          (joint owner who moved)
 *   4. same surname (relative — weaker, still surfaced for the producer to confirm)
 * If none plausibly qualify, returns null — we never attach a random person.
 */
function pickCoInsured(persons: any[], primary: any, lead: any): any | null {
  const others = persons.filter((p) => p !== primary);
  if (!others.length) return null;
  const o1Last = norm(lead.owner1LastName);
  const propStreet = norm(lead.addressStreet);
  const primaryAge = Number(primary?.age) || null;
  const ageOk = (p: any) => { const a = Number(p?.age); return primaryAge && a ? Math.abs(a - primaryAge) <= 15 : false; };
  const sameAddr = (p: any) => !!propStreet && personStreet(p) === propStreet;

  return others.find((p) => sameAddr(p) && ageOk(p))
    ?? others.find((p) => sameAddr(p))
    ?? others.find((p) => o1Last && norm(p.lastName) === o1Last && ageOk(p))
    ?? others.find((p) => o1Last && norm(p.lastName) === o1Last)
    ?? null;
}

/** Phones / emails on a single REAPI person, normalized to string arrays. */
function personContacts(p: any): { phones: string[]; emails: string[] } {
  const phones = (Array.isArray(p?.phones) ? p.phones : [])
    .map((ph: any) => (typeof ph === 'string' ? ph : ph?.phone)).filter(Boolean).map(String);
  const emails = (Array.isArray(p?.emails) ? p.emails : [])
    .map((em: any) => (typeof em === 'string' ? em : em?.email)).filter(Boolean).map(String);
  return { phones, emails };
}

/**
 * Pull phone/email arrays out of REAPI's v2 SkipTrace response, INSURED FIRST.
 * The insured's own contacts lead the list so phone1/email1 belong to the named
 * insured — not the co-insured or another person on the loan (Frank Jul-2026).
 */
function extractContacts(json: any, insured: any | null): { phones: string[]; emails: string[] } {
  const persons: any[] = Array.isArray(json?.persons) ? json.persons : [];
  const ordered = insured ? [insured, ...persons.filter((p) => p !== insured)] : persons;
  const phones: string[] = [];
  const emails: string[] = [];
  for (const p of ordered) {
    const c = personContacts(p);
    phones.push(...c.phones);
    emails.push(...c.emails);
  }
  return { phones: [...new Set(phones)], emails: [...new Set(emails)] };
}

/**
 * Map skip-trace persons onto the lead's Insured Info, filling EMPTY slots only
 * (never clobber producer entries). REAPI DOB comes strictly from the name-matched
 * insured; the co-insured is the plausible spouse/co-owner (see pickCoInsured). REAPI
 * returns `age`, not a birth date, so DOB is an estimated birth year the producer confirms.
 */
export function insuredPatchFromPersons(persons: any[], lead: any): Record<string, any> {
  const list = Array.isArray(persons) ? persons : [];
  if (!list.length) return {};

  const nameMatch = matchInsuredPerson(list, lead);
  const primary = nameMatch ?? list[0];
  const coInsured = pickCoInsured(list, primary, lead);

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
    // Co-insured's OWN contact info (Frank Oct-2026) — so the spouse gets their own
    // phone/email slots instead of being crowded out by the insured's numbers.
    const cc = personContacts(coInsured);
    if (!lead.owner2Phone && cc.phones[0]) patch.owner2Phone = cc.phones[0];
    if (!lead.owner2Email && cc.emails[0]) patch.owner2Email = cc.emails[0];
  }
  // Pre-fill the editable DOB fields (empty slots only); reapiDob above stays source-of-truth.
  if (!lead.owner1Dob && primary?.age) { const d = estDob(primary.age); if (d) patch.owner1Dob = d; }
  if (!lead.owner2Dob && coInsured?.age) { const d = estDob(coInsured.age); if (d) patch.owner2Dob = d; }
  return patch;
}

/**
 * Run a skip trace for a single lead against the owner name + property address.
 * Returns de-duplicated phones/emails (insured first); throws on transport / auth errors.
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
  // Insured-first contact ordering: phone1/email1 belong to the named insured.
  const insured = matchInsuredPerson(Array.isArray(json?.persons) ? json.persons : [], lead);
  const { phones, emails } = extractContacts(json, insured);
  const matched = json?.match === true || (json?.resultCount ?? 0) > 0
    || (Array.isArray(json?.persons) && json.persons.length > 0)
    || phones.length > 0 || emails.length > 0;

  return { phones, emails, matched, raw: json };
}
