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
