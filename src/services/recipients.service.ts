import { matchInsuredPerson } from './skipTrace.service';

/**
 * Who a household can actually be reached at.
 *
 * One definition, shared by the campaign push and the reachability report. They must not
 * drift: a report that counts addresses the push would never use promises reach we do
 * not have, and the gap would only show up as a cohort quietly under-performing its own
 * forecast.
 *
 * Reachability only — no suppression, no holdout, no primary-contact routing. Those are
 * decisions about whether to mail someone we CAN reach, and they belong to the push.
 */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Every address belonging to the NAMED INSURED — and nobody else.
 *
 * ── Why not emailsAll ────────────────────────────────────────────────────────
 * emailsAll is everything the skip trace returned for the PROPERTY, which routinely
 * includes relatives, prior owners and unrelated co-residents. One live example carries
 * 16 addresses across six surnames. Mailing that pool would send insurance-renewal
 * outreach to people who do not own the property — a complaint and bounce risk on
 * domains that have to stay clean.
 *
 * The raw trace payload attributes emails PER PERSON, so the insured's own addresses can
 * be picked out exactly. For the same lead that is 3 addresses, not 16.
 *
 * The co-insured is excluded here because they are a different person — see
 * coInsuredEmails, which is what the reachability report counts separately.
 */
export function insuredEmails(lead: any): string[] {
  const raw = Array.isArray(lead?.skipTraceData?.persons) ? lead.skipTraceData.persons : [];
  // The stored payload is the vendor's snake_case shape; matchInsuredPerson expects the
  // REAPI camelCase one. Normalise rather than duplicating the name-matching rules.
  const persons = raw.map((p: any) => ({
    ...p,
    firstName: p.firstName ?? p.first_name,
    lastName: p.lastName ?? p.last_name,
    emails: (Array.isArray(p.emails) ? p.emails : [])
      .map((e: any) => (typeof e === 'string' ? e : e?.email))
      .filter(Boolean),
  }));

  const insured = matchInsuredPerson(persons, lead);

  // The numbered slots come first: they are the insured's working addresses, and one may
  // have been typed in by a producer and never appear in any trace.
  const ordered = [lead.email1, lead.email2, ...(insured?.emails ?? [])];

  const coInsured = String(lead.owner2Email ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of ordered) {
    const email = String(value ?? '').trim().toLowerCase();
    if (!email || email === coInsured || seen.has(email) || !EMAIL_RE.test(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/**
 * The co-insured's own address, if we have one.
 *
 * Not mailed — campaigns go to the named insured only. Counted separately so the
 * reachability report can answer the question that decision raises: how many households
 * we could reach if the rule changed, and how many we can reach ONLY that way.
 */
export function coInsuredEmails(lead: any): string[] {
  const email = String(lead?.owner2Email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return [];

  // An address that is also one of the insured's is not extra reach. It happens: a
  // shared household address gets typed into both slots, and counting it twice would
  // overstate what mailing the co-insured would actually add.
  return insuredEmails(lead).includes(email) ? [] : [email];
}

/** Digits only, so 732-690-2327 and 7326902327 are recognised as one number. */
const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

/** A US number is 10 digits, or 11 starting with the country code. */
function normalisePhone(v: unknown): string | null {
  let d = digits(v);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/**
 * Every phone number belonging to the NAMED INSURED — the exact mirror of insuredEmails,
 * and for the same reason: phonesAll is everything the trace returned for the PROPERTY,
 * so counting it answers "is anyone at this address contactable" rather than "can we
 * reach the person whose policy is renewing".
 *
 * The two vendors disagree on the field name — Tracerfy returns `number`, REAPI returns
 * `phone` — so both are read. A shape that carries neither yields nothing rather than a
 * string of "[object Object]".
 */
export function insuredPhones(lead: any): string[] {
  const raw = Array.isArray(lead?.skipTraceData?.persons) ? lead.skipTraceData.persons : [];
  const persons = raw.map((p: any) => ({
    ...p,
    firstName: p.firstName ?? p.first_name,
    lastName: p.lastName ?? p.last_name,
    phones: (Array.isArray(p.phones) ? p.phones : [])
      .map((x: any) => (typeof x === 'string' ? x : x?.number ?? x?.phone))
      .filter(Boolean),
  }));

  const insured = matchInsuredPerson(persons, lead);
  const ordered = [lead?.phone1, lead?.phone2, ...(insured?.phones ?? [])];

  const coInsured = normalisePhone(lead?.owner2Phone);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of ordered) {
    const phone = normalisePhone(value);
    if (!phone || phone === coInsured || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

/** The co-insured's own number, when it is not already one of the insured's. */
export function coInsuredPhones(lead: any): string[] {
  const phone = normalisePhone(lead?.owner2Phone);
  if (!phone) return [];
  return insuredPhones(lead).includes(phone) ? [] : [phone];
}
