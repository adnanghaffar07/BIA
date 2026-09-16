import crypto from 'crypto';
import { insuredEmails, EMAIL_RE } from './recipients.service';
import { cohortOf } from './cohort';
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

/** Why a lead must not be mailed, or null. */
function suppressionReason(lead: any): string | null {
  if (lead.holdoutFlag === true) return 'holdout';
  if (lead.hardBounced === true) return 'suppressed';
  if (lead.campaignUnsubscribedAt) return 'suppressed';
  if (String(lead.campaignStatus ?? '') === 'suppressed') return 'suppressed';
  return null;
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

    /**
     * Once somebody has answered, they are the only address.
     *
     * A household that engaged has a primary contact recorded on the Lead, and from then
     * on the conversation belongs to that person — including the next renewal cycle,
     * which is why it is stored on the card rather than inferred from one campaign's
     * events. Without this the household stop would only hold until the next campaign:
     * the other addresses would be picked up again and mailed after their household had
     * already replied.
     *
     * Applied HERE and not inside insuredEmails, because that function is shared with
     * the reachability report — which has to count every address a household can be
     * reached at, not the one address we would currently route to.
     */
    const primary = String(lead.primaryContactEmail ?? '').trim().toLowerCase();
    const candidates = primary ? [primary] : insuredEmails(lead);

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
        // The cohort is SNAPSHOT here, not joined from the lead at report time. A
        // renewal date corrected next month moves the lead's cohort — correctly — but
        // must not retroactively move a send that already happened into a different
        // week's numbers.
        await client.query(
          `INSERT INTO "OutreachEvent"
             ("id","leadId","propertyId","personRole","recipientEmail","channel","vendorLeadId","vendorCampaignId","cohort","sentAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'campaign',$6,$7,$8,NOW(),NOW(),NOW())`,
          [
            crypto.randomUUID(), r.lead.id, r.lead.propertyId ?? null, r.personRole, r.email,
            outcome.leadId ?? null, campaignId,
            r.lead.cohort ?? cohortOf(r.lead.effectiveDate),
          ],
        );
        // "campaignCohort" is no longer written: it held the push FILTER
        // ("2026-11-09..2026-11-16"), which described the query someone ran rather than
        // the lead, and was only populated when that filter happened to carry both ends
        // of a range. "Lead"."cohort" is the lead's own cohort and is always set.
        await client.query(
          `UPDATE "Lead"
              SET "campaignStatus" = COALESCE(NULLIF("campaignStatus",''), 'queued'),
                  "vendorCampaignId" = $2,
                  "vendorLeadId" = COALESCE("vendorLeadId", $3),
                  "updatedAt" = NOW()
            WHERE "id" = $1`,
          [r.lead.id, campaignId, outcome.leadId ?? null],
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
