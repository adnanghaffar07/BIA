import crypto from 'crypto';
import { EMAIL_RE } from './recipients.service';
import { bestInsuredAddress, bestCoInsuredAddress, type AddressSignals } from './addressRank.service';
import { cohortOf } from './cohort';
import { pool } from '@/lib/neon';
import { getLeadsFromDb } from '@/services/storage.service';
import { loadActiveSuppressions } from './suppression.service';
import { householdKeyOf } from './household.service';
// `LeadInput` is a TYPE. Imported as a value it works under Next, whose bundler elides
// it, and throws "does not provide an export named 'LeadInput'" the moment this module is
// loaded by plain Node ESM — which is how every script in scripts/ loads it.
import { addLeadsToCampaign, findLeadsByEmail, type LeadInput } from '@/lib/integrations/leadCampaign';

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
 * Who this push is addressed to.
 *
 * Campaigns went to the named insured ONLY, and that is still the default — nothing
 * mails a co-insured unless it is chosen here deliberately. The reachability report is
 * what made the choice worth having: a real share of households have no insured address
 * and are contactable at the co-insured or not at all.
 *
 * The three modes are exclusive. 'coinsured' means the co-insured INSTEAD of the insured,
 * not as well — picking it deliberately does not mail the policyholder.
 */
export type RecipientMode = 'insured' | 'coinsured' | 'both';

export type PushOptions = {
  /** Defaults to 'insured' — the long-standing rule, kept as the safe default. */
  recipients?: RecipientMode;
};

export type Recipient = {
  lead: any;
  /** Which person this address belongs to; stored on the OutreachEvent. */
  personRole: 'insured' | 'coinsured';
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
  /**
   * How many addresses each mode would add, counted in the SAME pass.
   *
   * The dialog shows all three numbers at once, and recomputing them with three separate
   * requests would be both slower and capable of disagreeing with each other if a trace
   * landed in between.
   */
  byMode: { insured: number; coinsured: number; both: number };
  /** Leads with an address for that person, as opposed to addresses. */
  leadsByMode: { insured: number; coinsured: number; both: number };
};

/**
 * Why a lead must not be mailed, or null.
 *
 * ── The Suppression table has to be consulted here ──────────────────────────
 * This used to read four columns on the Lead and nothing else, which meant the entire
 * Suppression table was invisible to the one code path that actually sends. Everything
 * written by suppress() — a bind, an unsubscribe, a complaint, a "not interested" reply,
 * a do-not-contact scrub — was recorded, reported, and then pushed to anyway.
 *
 * It was not visibly broken because the reconciliation sweep removes a suppressed
 * recipient from the campaign afterwards. That is a repair, not a guard: between the push
 * and the next sweep the recipient is live, and a scheduled send inside that window goes
 * out. For a household that has just bought a policy from us, that send is the single most
 * embarrassing message this system can produce.
 *
 * ── Only the HOUSEHOLD scope is checked here ────────────────────────────────
 * The two scopes mean different things and must not be collapsed. A household stop —
 * a bind, an unsubscribe, a complaint — ends outreach to the card, so it belongs at this
 * level. An address stop is about one mailbox: a hard bounce on the insured's old work
 * address says nothing about their personal one, and skipping the whole lead for it would
 * discard a reachable prospect. Address-scope suppressions are applied to the candidate
 * addresses after ranking instead.
 *
 * `sup` is loaded once per triage and passed in, rather than queried per lead — the bulk
 * loader exists for exactly this and a push covers thousands of leads.
 */
function suppressionReason(
  lead: any,
  sup: { households: Set<string> },
): string | null {
  if (lead.holdoutFlag === true) return 'holdout';
  if (lead.hardBounced === true) return 'suppressed';
  if (lead.campaignUnsubscribedAt) return 'suppressed';
  if (String(lead.campaignStatus ?? '') === 'suppressed') return 'suppressed';
  if (sup.households.has(householdKeyOf(lead))) return 'suppressed';
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

  /**
   * Address-level history for the ranking (playbook 04, signal 5).
   *
   * Workspace-wide, not per campaign: an address that hard-bounced in October is still
   * dead in November, and one that replied is still the way in. Scoped to addresses, not
   * leads, because the whole point of the rule is to choose BETWEEN a person's addresses.
   */
  const { rows: history } = await pool.query(
    `SELECT lower("recipientEmail") AS email,
            bool_or("bounceType" = 'hard')                             AS hard_bounced,
            bool_or("repliedAt" IS NOT NULL OR "clickedAt" IS NOT NULL) AS engaged
       FROM "OutreachEvent"
      WHERE "recipientEmail" IS NOT NULL
      GROUP BY 1`,
  );
  const signals: AddressSignals = {
    hardBounced: new Set(history.filter((h) => h.hard_bounced).map((h) => h.email)),
    engaged: new Set(history.filter((h) => h.engaged).map((h) => h.email)),
    // No verifier chosen yet (register A25). Everything reads 'unknown' and the ranking
    // falls through to the name / vendor-rank / domain signals.
    verification: undefined,
  };

  /**
   * Every active suppression, loaded once.
   *
   * Read here rather than per lead: a push covers thousands of leads and the bulk loader
   * exists for this. Household keys and addresses come back as sets, so the per-lead test
   * below is in memory.
   */
  const sup = await loadActiveSuppressions();

  const mode: RecipientMode = opts.recipients ?? 'insured';

  const skipped = { noEmail: 0, suppressed: 0, holdout: 0, alreadyInCampaign: 0, duplicateAddress: 0 };
  const eligible: Recipient[] = [];
  // One address gets one send, even when two leads share it (a couple owning two
  // properties, or a landlord). The second occurrence is reported, not mailed.
  const seenAddresses = new Set<string>();

  // Counted for all three modes in this one pass, so the dialog's chips agree with each
  // other and with whatever is actually pushed.
  const byMode = { insured: 0, coinsured: 0, both: 0 };
  const leadsByMode = { insured: 0, coinsured: 0, both: 0 };

  for (const lead of leads) {
    const suppress = suppressionReason(lead, sup);
    if (suppress === 'holdout') { skipped.holdout++; continue; }
    if (suppress) { skipped.suppressed++; continue; }

    /**
     * ONE address per person per touch — playbook Section 04.
     *
     * This used to take every address we held for the insured, which came out at 1.66
     * sends per card and up to 3 on some. The locked policy is "the top-ranked surviving
     * address, never two at once", targeting ~1.3 sends per lead per touch. Ranking is in
     * addressRank.service.ts.
     */
    const insBest = bestInsuredAddress(lead, signals);
    const coBest = bestCoInsuredAddress(lead, signals);
    /**
     * Address-scope suppressions applied to the chosen address, not to the lead.
     *
     * A mailbox suppressed on its own account (a hard bounce, or an opt-out that named
     * only that address) is dropped here. If the person's other address survives ranking
     * the lead still goes — which is the difference between "this mailbox is dead" and
     * "this household said stop".
     */
    const usable = (e: string | undefined) => !!e && !sup.emails.has(e.toLowerCase().trim());
    const ins = insBest && usable(insBest.email) ? [insBest.email] : [];
    const co = coBest && usable(coBest.email) ? [coBest.email] : [];

    byMode.insured += ins.length;
    byMode.coinsured += co.length;
    byMode.both += ins.length + co.length;
    if (ins.length) leadsByMode.insured++;
    if (co.length) leadsByMode.coinsured++;
    if (ins.length || co.length) leadsByMode.both++;

    // Whichever people this push is addressed to, tagged so the OutreachEvent records
    // who each address actually belongs to.
    //
    // Role selection happens HERE rather than inside insuredEmails/coInsuredEmails,
    // because those are shared with the reachability report — which has to count every
    // address a household can be reached at, not the ones this push happens to want.
    let candidates: Recipient[] = [
      ...(mode !== 'coinsured' ? ins.map((email) => ({ lead, personRole: 'insured' as const, email })) : []),
      ...(mode !== 'insured' ? co.map((email) => ({ lead, personRole: 'coinsured' as const, email })) : []),
    ];

    /**
     * Once somebody has answered, they are the only address — whichever mode is chosen.
     *
     * A household that engaged has a primary contact recorded on the Lead, and from then
     * on the conversation belongs to that person, including into the next renewal cycle.
     * Without this the household stop would only hold until the next campaign: the other
     * addresses would be picked up again and mailed after their household had replied.
     *
     * If the person who answered is not in the selected set — asking for co-insured on a
     * card where the INSURED replied — the card is skipped rather than silently mailing
     * somebody else. Writing to a different member of a household that is already in
     * conversation with us is worse than not writing at all.
     */
    const primary = String(lead.primaryContactEmail ?? '').trim().toLowerCase();
    if (primary) candidates = candidates.filter((c) => c.email === primary);

    let gotOne = false;
    for (const c of candidates) {
      if (!EMAIL_RE.test(c.email)) continue;
      gotOne = true;
      // Keyed by ADDRESS, not by role. One lead now contributes several addresses, so a
      // role-only key would let the first one mask the rest and report them as "already
      // in campaign".
      if (alreadyEmails.has(c.email)) { skipped.alreadyInCampaign++; continue; }
      if (seenAddresses.has(c.email)) { skipped.duplicateAddress++; continue; }
      seenAddresses.add(c.email);
      eligible.push(c);
    }
    // "No email" means no address FOR THE SELECTED PEOPLE — a card with only a
    // co-insured address genuinely has nothing to send to under an insured-only push.
    if (!gotOne) skipped.noEmail++;
  }

  return { matching: leads.length, eligible, skipped, byMode, leadsByMode };
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
        /**
         * The band is recorded as PUBLISHED, because it is published here.
         *
         * band_low / band_high go to the platform as merge variables just above, so the
         * figure the homeowner reads in email 2 is decided at this moment — and until now
         * it was never written down on our side. Playbook §03: "no code anywhere compares
         * the band we published to the premium we bound… there is no retrofitting it,
         * because the dataset only starts accumulating the day the first band leaves."
         */
        await client.query(
          `INSERT INTO "OutreachEvent"
             ("id","leadId","propertyId","personRole","recipientEmail","channel","vendorLeadId","vendorCampaignId","cohort","publishedBandLow","publishedBandHigh","sentAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'campaign',$6,$7,$8,$9,$10,NOW(),NOW(),NOW())`,
          [
            crypto.randomUUID(), r.lead.id, r.lead.propertyId ?? null, r.personRole, r.email,
            outcome.leadId ?? null, campaignId,
            r.lead.cohort ?? cohortOf(r.lead.effectiveDate),
            r.lead.indicativeBandLow ?? null, r.lead.indicativeBandHigh ?? null,
          ],
        );
        // "campaignCohort" is no longer written: it held the push FILTER
        // ("2026-11-09..2026-11-16"), which described the query someone ran rather than
        // the lead, and was only populated when that filter happened to carry both ends
        // of a range. "Lead"."cohort" is the lead's own cohort and is always set.
        // COALESCE on the band: the FIRST band a household was shown is the one its bind
        // gets judged against. A later cycle at a new valuation must not rewrite history.
        await client.query(
          `UPDATE "Lead"
              SET "campaignStatus" = COALESCE(NULLIF("campaignStatus",''), 'queued'),
                  "vendorCampaignId" = $2,
                  "vendorLeadId" = COALESCE("vendorLeadId", $3),
                  "publishedBandLow"  = COALESCE("publishedBandLow", $4),
                  "publishedBandHigh" = COALESCE("publishedBandHigh", $5),
                  "publishedBandAt"   = CASE WHEN "publishedBandAt" IS NULL AND $4 IS NOT NULL
                                             THEN NOW() ELSE "publishedBandAt" END,
                  "updatedAt" = NOW()
            WHERE "id" = $1`,
          [
            r.lead.id, campaignId, outcome.leadId ?? null,
            r.lead.indicativeBandLow ?? null, r.lead.indicativeBandHigh ?? null,
          ],
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
