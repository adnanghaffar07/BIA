import type { Lead } from '@/types/lead';
import { insuredPatchFromPersons } from './skipTrace.service';
import { readVendorJson } from './vendorErrors';
import { logTrace } from './skipTraceLog.service';

/**
 * BatchData skip trace — the FALLBACK, used only where Tracerfy came back empty.
 *
 * Endpoint (verified live, Sep 2026):
 *   POST https://api.batchdata.com/api/v1/property/skip-trace
 *   auth: Bearer <BATCHDATA_API_KEY>
 *   body: { requests: [ { propertyAddress: { street, city, state, zip } } ] }   (≤100 per call)
 *   → { status:{code}, results:{ persons:[ {
 *          name:{first,middle,last,full},
 *          phoneNumbers:[{number,type,carrier,tested,reachable,dnc,score}],
 *          emails:[{email,tested}],
 *          death:{deceased}, dnc:{tcpa}, litigator,
 *          property:{ owner:{ name:{first,middle,last,full} } },
 *          meta:{matched,error,errorMessage} } ] },
 *        meta:{results:{requestCount,matchCount,noMatchCount,errorCount}} }
 *
 * ── Why a second provider ───────────────────────────────────────────────────
 * Tracerfy is the primary and stays that way. But 478 leads in the current book have been
 * deep traced and STILL have no address for the insured, and re-running the same vendor on
 * them returns the same nothing. Those are the only leads a second source can add to; this
 * exists for them and should not be pointed at anything else.
 *
 * ── The trap this service exists to avoid ───────────────────────────────────
 * BatchData resolves ONE person for an address rather than returning candidates. That
 * person's name can legitimately differ from the name on our lead — the first live call
 * returned "Danielle Marie Dalbora" for a property whose owner record, in the same
 * response, reads "Danielle M Weidmyer". A maiden or married name.
 *
 * Our reachability rules attribute addresses per person BY NAME (see recipients.service).
 * Hand them "Dalbora" against an insured called "Weidmyer" and every address is discarded
 * as a stranger's — three real emails, silently dropped, on a lead that has none. Hand
 * them the owner name unconditionally and the opposite failure appears: a genuine stranger
 * at the address gets mailed as the insured.
 *
 * So the link is verified rather than assumed: the response's OWN property.owner block is
 * compared to our owner1, and only when the surname agrees is the person emitted under the
 * insured's name. When it does not, the person is emitted under the name BatchData gave,
 * and the normal matching rules decide — which for an unrelated person means the addresses
 * are correctly not counted as the insured's.
 */

const SKIP_TRACE_URL = 'https://api.batchdata.com/api/v1/property/skip-trace';

export interface BatchDataResult {
  phones: string[];
  emails: string[];
  matched: boolean;
  /** Full response, kept for audit the way the Tracerfy payload is. */
  raw?: unknown;
  /** Co-insured + DOB, empty-slot fill only. */
  insuredPatch: Record<string, any>;
  personCount: number;
  /** The owner name BatchData reports for the property — for the name-mismatch QC tab. */
  ownerName: string | null;
  /** Whether the resolved person could be tied to our insured. */
  ownerVerified: boolean;
  /** Normalised persons[], in the shape recipients.service and skipTrace helpers expect. */
  persons: any[];
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim();

/**
 * BatchData's person, mapped onto the REAPI person shape the rest of the system uses.
 *
 * `emails[].tested` and `phoneNumbers[].score` are carried through rather than flattened:
 * they are the vendor's own confidence, and the address-ranking rules already know how to
 * prefer a verified address over an unverified one.
 */
function toReapiPerson(p: any, nameOverride: { first: string; last: string } | null) {
  const n = p?.name ?? {};
  return {
    firstName: nameOverride ? nameOverride.first : (n.first ?? ''),
    lastName: nameOverride ? nameOverride.last : (n.last ?? ''),
    // Kept whatever we labelled the person, so the substitution is auditable.
    batchDataName: n.full ?? null,
    age: null,
    dob: null,
    address: { streetAddress: p?.propertyAddress?.street ?? '' },
    phones: (Array.isArray(p?.phoneNumbers) ? p.phoneNumbers : [])
      .map((ph: any) => ({
        phone: String(ph?.number ?? ''),
        type: ph?.type,
        dnc: !!ph?.dnc,
        reachable: ph?.reachable !== false,
        score: ph?.score ?? null,
      })),
    emails: (Array.isArray(p?.emails) ? p.emails : [])
      .map((em: any) => ({ email: String(em?.email ?? ''), verified: !!em?.tested })),
  };
}

/**
 * Trace one lead through BatchData.
 *
 * Throws on transport or auth failure so a caller can stop a run rather than record a
 * string of false misses — the lesson from the Tracerfy blast that made ~290 pointless
 * calls after the account ran dry.
 */
export async function runBatchData(
  lead: Lead | any,
  /** Set by a blast so its traces can be summarised as one run (Frank, 1 Oct). */
  opts: { runId?: string | null; by?: string | null } = {},
): Promise<BatchDataResult> {
  const startedAt = Date.now();
  const key = process.env.BATCHDATA_API_KEY;
  if (!key) throw new Error('BATCHDATA_API_KEY is not set');

  const street = lead?.addressStreet ?? lead?.address?.street ?? '';
  const city = lead?.addressCity ?? lead?.address?.city ?? '';
  const zip = lead?.addressZip ?? lead?.address?.zip ?? '';
  if (!street || !zip) {
    return {
      phones: [], emails: [], matched: false, insuredPatch: {}, personCount: 0,
      ownerName: null, ownerVerified: false, persons: [],
    };
  }

  const res = await fetch(SKIP_TRACE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ propertyAddress: { street, city, state: 'NJ', zip } }],
    }),
  });

  // Same classification as Tracerfy: the blast stops on an account fault and carries on
  // past a lead this vendor simply could not use. BatchData in particular answers a bad
  // key with 200 and an HTML sign-in page, which readVendorJson catches.
  const json: any = await readVendorJson('BatchData', res);
  const person = json?.results?.persons?.[0];
  const matched = person?.meta?.matched === true && person?.meta?.error !== true;

  /**
   * ── The request carries no name, and that is the record ──────────────────
   *
   * Frank asked whether a vendor picks the owner from the address alone, because if so
   * "our verified names never reach it". For BatchData the answer is yes, always: the body
   * above is a propertyAddress and nothing else. Writing sentFirstName as null is not a gap
   * in the log — it is that fact, stored per trace, so the question has an answer next time
   * without anybody reading this file.
   */
  const logged = async (outcome: 'hit' | 'miss', extra: {
    returnedName?: string | null; personCount?: number; phoneCount?: number; emailCount?: number;
  }) => logTrace({
    leadId: String(lead?.id ?? ''),
    propertyId: lead?.propertyId ? String(lead.propertyId) : null,
    provider: 'batchdata',
    tier: 'skip-trace',
    runId: opts.runId ?? null,
    sentFirstName: null,
    sentLastName: null,
    sentAddress: String(street),
    sentCity: String(city),
    sentState: 'NJ',
    sentZip: String(zip),
    requests: 1,
    outcome,
    credits: Number(json?.results?.meta?.credits ?? json?.credits ?? 0) || null,
    durationMs: Date.now() - startedAt,
    createdBy: opts.by ?? null,
    ...extra,
  });

  if (!matched) {
    await logged('miss', {
      returnedName: person?.property?.owner?.name?.full ?? null,
      personCount: 0, phoneCount: 0, emailCount: 0,
    });
    return {
      phones: [], emails: [], matched: false, raw: json, insuredPatch: {}, personCount: 0,
      ownerName: person?.property?.owner?.name?.full ?? null,
      ownerVerified: false,
      persons: [],
    };
  }

  // The verification described at the top of this file.
  const ownerLast = norm(person?.property?.owner?.name?.last);
  const leadLast = norm(lead?.owner1LastName);
  const ownerVerified = !!ownerLast && !!leadLast && ownerLast === leadLast;

  const persons = [toReapiPerson(
    person,
    ownerVerified ? { first: lead.owner1FirstName ?? '', last: lead.owner1LastName ?? '' } : null,
  )];

  const emails: string[] = persons[0].emails.map((e: any) => e.email).filter(Boolean);
  const phones: string[] = persons[0].phones.map((p: any) => p.phone).filter(Boolean);

  await logged('hit', {
    returnedName: person?.property?.owner?.name?.full ?? null,
    personCount: persons.length,
    phoneCount: phones.length,
    emailCount: emails.length,
  });

  return {
    phones,
    emails,
    matched: true,
    raw: json,
    // Reuses the existing co-insured/DOB derivation so the two providers cannot disagree
    // about what a patch looks like.
    insuredPatch: insuredPatchFromPersons(persons, lead) ?? {},
    personCount: persons.length,
    ownerName: person?.property?.owner?.name?.full ?? null,
    ownerVerified,
    persons,
  };
}
