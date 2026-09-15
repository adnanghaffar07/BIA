import crypto from 'crypto';
import { matchInsuredPerson } from './skipTrace.service';
import { pool } from '@/lib/neon';
import { getLeadsFromDb } from '@/services/storage.service';
import { addLeadsToCampaign, findLeadsByEmail, LeadInput } from '@/lib/integrations/leadCampaign';

/**
 * Push CRM leads into a campaign.
 *
 * This is the link that makes the integration a loop rather than two halves. For every
 * lead that the platform accepts, we write ONE OutreachEvent row carrying the vendor's
 * lead id, the campaign id and the recipient address — which is exactly the key the
 * webhook later looks up to route a reply, bounce or open back onto the CRM record.
 * No row here means an inbound reply has nothing to land on.
 *
 * The filter set is the Leads page's own — same keys, same getLeadsFromDb call — so
 * the cohort pushed is the cohort the user was looking at, not a similar query that
 * drifts from it.
 */

export type PushFilters = {
  grade?: string;
  status?: string;
  carrier?: string;
  propertyType?: string;
  county?: string;
  zip?: string;
  engine?: number;
  effectiveDate?: string;
  effectiveTo?: string;
};

/**
 * No options remain — campaigns go to the named insured only, which is a rule rather
 * than a per-push choice. Kept as a type so the call signatures stay stable.
 */
export type PushOptions = Record<string, never>;

export type Recipient = {
  lead: any;
  /** Always the insured; the co-insured is never mailed. */
  personRole: 'insured';
  email: string;
};

export type PushTriage = {
  matching: number;
  eligible: Recipient[];
  skipped: {
    noEmail: number;
    suppressed: number;
    holdout: number;
    alreadyInCampaign: number;
    duplicateAddress: number;
  };
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Why a lead must not be mailed, or null. */
function suppressionReason(lead: any): string | null {
  if (lead.holdoutFlag === true) return 'holdout';
  if (lead.hardBounced === true) return 'suppressed';
  if (lead.campaignUnsubscribedAt) return 'suppressed';
  if (String(lead.campaignStatus ?? '') === 'suppressed') return 'suppressed';
  return null;
}

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
 * The raw trace payload attributes emails PER PERSON, so the insured's own addresses
 * can be picked out exactly. For the same lead that is 3 addresses, not 16.
 *
 * The co-insured is excluded outright: their address is a different person's, and the
 * decision is that campaigns go to the named insured only.
 */
function insuredEmails(lead: any): string[] {
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

  // The numbered slots come first: they are the insured's working addresses, and one
  // may have been typed in by a producer and never appear in any trace.
  const ordered = [
    lead.email1,
    lead.email2,
    ...(insured?.emails ?? []),
  ];

  const coInsured = String(lead.owner2Email ?? '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of ordered) {
    const email = String(value ?? '').trim().toLowerCase();
    if (!email || email === coInsured || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/**
 * Work out who would actually be mailed.
 *
 * Free — no vendor calls — so the UI can show the real number before anyone spends a
 * send. Everything excluded is counted by reason rather than silently dropped.
 */
export async function triagePush(
  campaignId: string,
  filters: PushFilters,
  opts: PushOptions = {},
): Promise<PushTriage> {
  const leads = await getLeadsFromDb({ ...filters, limit: 100000, orderBy: 'xdate' });

  // Which ADDRESSES are already in THIS campaign. Pushing the same person twice is how
  // somebody receives the sequence from the start a second time.
  const { rows: existing } = await pool.query(
    `SELECT "recipientEmail" FROM "OutreachEvent" WHERE "vendorCampaignId" = $1`,
    [campaignId],
  );
  const alreadyEmails = new Set(
    existing.map((r) => String(r.recipientEmail ?? '').trim().toLowerCase()).filter(Boolean),
  );

  const skipped = { noEmail: 0, suppressed: 0, holdout: 0, alreadyInCampaign: 0, duplicateAddress: 0 };
  const eligible: Recipient[] = [];
  // One address gets one send, even when two leads share it (a couple owning two
  // properties, or a landlord). The second occurrence is reported, not mailed.
  const seenAddresses = new Set<string>();

  for (const lead of leads) {
    const suppress = suppressionReason(lead);
    if (suppress === 'holdout') { skipped.holdout++; continue; }
    if (suppress) { skipped.suppressed++; continue; }

    const candidates = insuredEmails(lead);

    let gotOne = false;
    for (const email of candidates) {
      if (!EMAIL_RE.test(email)) continue;
      gotOne = true;
      // Keyed by ADDRESS, not by role. One lead now contributes several insured
      // addresses, so a role-only key would let the first one mask the rest and
      // report them as "already in campaign".
      if (alreadyEmails.has(email)) { skipped.alreadyInCampaign++; continue; }
      if (seenAddresses.has(email)) { skipped.duplicateAddress++; continue; }
      seenAddresses.add(email);
      eligible.push({ lead, personRole: 'insured', email });
    }
    if (!gotOne) skipped.noEmail++;
  }

  return { matching: leads.length, eligible, skipped };
}

export type PushResult = {
  pushed: number;
  failed: number;
  skippedOnPlatform: number;
  remaining: number;
  done: boolean;
  results: Array<{ email: string; propertyId: string | null; ok: boolean; reason?: string }>;
};

/**
 * Push one bounded chunk.
 *
 * Bounded for the same reason as the skip-trace blast: the platform has no bulk lead
 * endpoint, so this is one HTTP call per recipient plus a dedup check, and a cohort of
 * 300 would sit far past any serverless timeout. Each chunk commits before returning,
 * and a pushed recipient gains an OutreachEvent row and therefore drops out of the
 * eligible set — so the next call resumes naturally and can never double-push.
 */
export async function pushChunk(
  campaignId: string,
  filters: PushFilters,
  opts: PushOptions,
  chunkSize: number,
  actor: string | null,
): Promise<PushResult> {
  const triage = await triagePush(campaignId, filters, opts);
  const batch = triage.eligible.slice(0, chunkSize);
  if (!batch.length) {
    return { pushed: 0, failed: 0, skippedOnPlatform: 0, remaining: 0, done: true, results: [] };
  }

  // Workspace-wide dedup before spending a send: the platform's per-campaign duplicate
  // flag does not stop the same homeowner sitting in two campaigns at once.
  const toSend: Recipient[] = [];
  const results: PushResult['results'] = [];
  let skippedOnPlatform = 0;
  for (const r of batch) {
    const existing = await findLeadsByEmail(r.email);
    if (existing.length) {
      skippedOnPlatform++;
      results.push({ email: r.email, propertyId: r.lead.propertyId ?? null, ok: false, reason: 'already on the platform' });
      continue;
    }
    toSend.push(r);
  }
  if (!toSend.length) {
    return {
      pushed: 0, failed: 0, skippedOnPlatform,
      remaining: Math.max(triage.eligible.length - batch.length, 0),
      done: triage.eligible.length <= batch.length,
      results,
    };
  }

  const payload: LeadInput[] = toSend.map((r) => ({
    email: r.email,
    first_name: r.personRole === 'insured' ? (r.lead.owner1FirstName ?? undefined) : (r.lead.owner2FirstName ?? undefined),
    last_name: r.personRole === 'insured' ? (r.lead.owner1LastName ?? undefined) : (r.lead.owner2LastName ?? undefined),
    custom_variables: {
      // Carried so a lead in the platform can be traced back to the CRM record, and so
      // sequence copy can merge real figures rather than generic filler.
      crm_property_id: r.lead.propertyId ?? null,
      property_address: [r.lead.addressStreet, r.lead.addressCity].filter(Boolean).join(', ') || null,
      renewal_date: r.lead.effectiveDate ?? null,
      band_low: r.lead.indicativeBandLow ?? null,
      band_high: r.lead.indicativeBandHigh ?? null,
    },
  }));

  const added = await addLeadsToCampaign(campaignId, payload);
  const byEmail = new Map(added.map((a) => [a.email, a]));

  const client = await pool.connect();
  let pushed = 0, failed = 0;
  try {
    for (const r of toSend) {
      const outcome = byEmail.get(r.email);
      if (!outcome?.ok) {
        failed++;
        results.push({ email: r.email, propertyId: r.lead.propertyId ?? null, ok: false, reason: outcome?.error ?? 'rejected by the platform' });
        continue;
      }

      // Row + lead state together. A send-log row without the lead marked active would
      // let the next push pick the same person up again.
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO "OutreachEvent"
             ("id","leadId","propertyId","personRole","recipientEmail","channel","vendorLeadId","vendorCampaignId","sentAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'campaign',$6,$7,NOW(),NOW(),NOW())`,
          [crypto.randomUUID(), r.lead.id, r.lead.propertyId ?? null, r.personRole, r.email, outcome.leadId ?? null, campaignId],
        );
        await client.query(
          `UPDATE "Lead"
              SET "campaignStatus" = COALESCE(NULLIF("campaignStatus",''), 'queued'),
                  "vendorCampaignId" = $2,
                  "vendorLeadId" = COALESCE("vendorLeadId", $3),
                  "campaignCohort" = COALESCE("campaignCohort", $4),
                  "updatedAt" = NOW()
            WHERE "id" = $1`,
          [r.lead.id, campaignId, outcome.leadId ?? null, filters.effectiveDate && filters.effectiveTo ? `${filters.effectiveDate}..${filters.effectiveTo}` : null],
        );
        await client.query(
          `INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
           VALUES (gen_random_uuid()::text, $1, 'campaign_event', $2, $3, NOW())`,
          [r.lead.id, `Added to an email campaign (${r.email})`, actor ?? 'campaign push'],
        );
        await client.query('COMMIT');
        pushed++;
        results.push({ email: r.email, propertyId: r.lead.propertyId ?? null, ok: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        failed++;
        results.push({
          email: r.email, propertyId: r.lead.propertyId ?? null, ok: false,
          // The lead IS on the platform but we failed to record it locally — say so
          // precisely, because that is the one state a retry cannot silently fix.
          reason: `added on the platform but not recorded locally: ${(err as Error)?.message ?? 'db error'}`,
        });
      }
    }
  } finally {
    client.release();
  }

  const processed = pushed + failed + skippedOnPlatform;
  const remaining = Math.max(triage.eligible.length - processed, 0);
  return { pushed, failed, skippedOnPlatform, remaining, done: remaining === 0 || processed === 0, results };
}
