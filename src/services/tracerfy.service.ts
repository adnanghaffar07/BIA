import type { Lead } from '@/types/lead';
import { matchInsuredPerson, insuredPatchFromPersons } from './skipTrace.service';

/**
 * Tracerfy skip trace (Frank Aug-2026) — REPLACES the REAPI skip trace, whose data was
 * corrupt (wrong owners, junk emails like "jessica6267@netscape.com"). Tracerfy returns
 * real, ranked owner contacts with DNC/TCPA/carrier flags.
 *
 * Endpoint (verified live): POST https://tracerfy.com/v1/api/trace/lookup/
 *   body: { address, city, state, zip, find_owner: true }   auth: Bearer <TRACERFY_API_KEY>
 *   → { hit, persons:[{ first_name, last_name, age, mailing_address:{street,...},
 *        phones:[{ number, type, dnc, tcpa, carrier, rank }], emails:[{ email, rank }] }],
 *        credits_deducted }   (5 credits per hit, 0 on miss)
 *
 * The insured/co-insured/DOB logic already exists for the old provider, so we normalize
 * Tracerfy's people onto that person shape and reuse it verbatim.
 */
const LOOKUP_URL = 'https://tracerfy.com/v1/api/trace/lookup/';
// Deep / enhanced tier (Frank Aug-2026) — a SEPARATE endpoint that targets the named
// insured and returns deeper context (linked addresses, relatives → more phones/emails).
// Higher credit cost; used only to recover a missing phone/email on a partial hit.
const ENHANCED_URL = 'https://tracerfy.com/v1/api/trace/enhanced/lookup/';

export interface TracerfyResult {
  phones: string[];
  emails: string[];
  matched: boolean;
  raw?: unknown;                      // full Tracerfy response (keeps DNC/TCPA/carrier/rank)
  insuredPatch: Record<string, any>;  // co-insured + DOB, empty-slot fill only
  personCount: number;
}

/**
 * Map a Tracerfy person onto the REAPI-person shape the skipTrace helpers expect
 * (firstName / lastName / age / address.streetAddress / phones[].phone / emails[].email),
 * so matchInsuredPerson, pickCoInsured, and insuredPatchFromPersons work unchanged.
 */
function toReapiPerson(p: any) {
  return {
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    age: p?.age ?? null,
    address: { streetAddress: p?.mailing_address?.street ?? '' },
    phones: (Array.isArray(p?.phones) ? p.phones : [])
      .map((ph: any) => ({ phone: String(ph?.number ?? ''), dnc: !!ph?.dnc, type: ph?.type, rank: ph?.rank })),
    emails: (Array.isArray(p?.emails) ? p.emails : [])
      .map((em: any) => ({ email: String(em?.email ?? ''), rank: em?.rank })),
  };
}

/**
 * Skip trace one lead by property address. Returns de-duplicated phones/emails with the
 * named INSURED's contacts first (so phone1/email1 belong to them, not a co-owner), plus
 * the co-insured/DOB patch and the full raw response. Throws on transport / auth errors.
 */
export async function runTracerfy(lead: Lead, opts?: { deep?: boolean }): Promise<TracerfyResult> {
  const key = process.env.TRACERFY_API_KEY;
  if (!key) throw new Error('Tracerfy API key not configured (TRACERFY_API_KEY).');

  const l = lead as any;
  const address = String(l.addressStreet ?? '').trim();
  const city = String(l.addressCity ?? '').trim();
  const state = String(l.addressState ?? 'NJ').trim();
  const zip = String(l.addressZip ?? '').trim();
  if (!address || !city) {
    throw new Error('Lead is missing a property address, so it cannot be skip traced.');
  }

  let url = LOOKUP_URL;
  let body: Record<string, any>;
  if (opts?.deep) {
    // Enhanced endpoint targets the named insured — needs first + last.
    const first = String(l.owner1FirstName ?? '').trim();
    const last = String(l.owner1LastName ?? '').trim();
    if (!first || !last) {
      throw new Error('Deep skip trace needs the insured first + last name on file.');
    }
    url = ENHANCED_URL;
    body = { first_name: first, last_name: last, address, city, state, zip };
  } else {
    body = { address, city, state, zip, find_owner: true };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Tracerfy error ${res.status}: ${t.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const rawPersons: any[] = Array.isArray(json?.persons) ? json.persons : [];
  const persons = rawPersons.map(toReapiPerson);

  // Insured first — same ordering rule as the old provider.
  const insured = matchInsuredPerson(persons, l);
  const ordered = insured ? [insured, ...persons.filter((p: any) => p !== insured)] : persons;
  const phones: string[] = [];
  const emails: string[] = [];
  for (const p of ordered) {
    for (const ph of p.phones) if (ph.phone) phones.push(ph.phone);
    for (const em of p.emails) if (em.email) emails.push(em.email);
  }

  const insuredPatch = insuredPatchFromPersons(persons, l);

  // Deep / enhanced trace: the recovered household contacts live in `relatives`, NOT in
  // persons[] (the named insured often has few/no emails of their own). Fill the co-insured
  // slots from the top-ranked relative so a married/family household stays reachable, and
  // add their numbers/emails to the overall pool. Producer confirms who's who on the call.
  if (opts?.deep && rawPersons[0]?.relatives?.length) {
    const rels = [...rawPersons[0].relatives].sort((a: any, b: any) => (a?.rank ?? 99) - (b?.rank ?? 99));
    const relPhone = (r: any) => (Array.isArray(r?.phones) ? r.phones[0]?.number : undefined);
    const relEmail = (r: any) => (Array.isArray(r?.emails) ? r.emails[0]?.email : undefined);
    // Prefer the top-ranked relative that actually has a contact to hand over.
    const top = rels.find((r: any) => relPhone(r) || relEmail(r)) ?? rels[0];
    if (top) {
      if (!l.owner2FirstName && !insuredPatch.owner2FirstName && top.first_name) insuredPatch.owner2FirstName = top.first_name;
      if (!l.owner2LastName && !insuredPatch.owner2LastName && top.last_name) insuredPatch.owner2LastName = top.last_name;
      if (!l.owner2Phone && !insuredPatch.owner2Phone && relPhone(top)) insuredPatch.owner2Phone = String(relPhone(top));
      if (!l.owner2Email && !insuredPatch.owner2Email && relEmail(top)) insuredPatch.owner2Email = String(relEmail(top));
    }
  }

  return {
    phones: [...new Set(phones)],
    emails: [...new Set(emails)],
    matched: !!json?.hit && (persons.length > 0),
    raw: json,
    insuredPatch,
    personCount: persons.length,
  };
}
