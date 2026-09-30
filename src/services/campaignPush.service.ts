import { globalMergeVars } from './globalMergeVars.service';
import crypto from 'crypto';
import { EMAIL_RE } from './recipients.service';
import { allInsuredAddresses, allCoInsuredAddresses, type AddressSignals } from './addressRank.service';
import { cohortOf } from './cohort';
import { pool } from '@/lib/neon';
import { getLeadsFromDb } from '@/services/storage.service';
import { loadActiveSuppressions } from './suppression.service';
import { heldAddresses } from './emailNameReview.service';
import { householdScopeKey } from './household.service';
// `LeadInput` is a TYPE. Imported as a value it works under Next, whose bundler elides
// it, and throws "does not provide an export named 'LeadInput'" the moment this module is
// loaded by plain Node ESM — which is how every script in scripts/ loads it.
import { addLeadsToCampaign, findLeadsByEmail, type LeadInput } from '@/lib/integrations/leadCampaign';
import { type Segment } from './campaignSegment.service';
import { mergeVarsFor, customOnly, agencyWebsite } from './mergeVars.service';
import { resolveInboxCollisions } from './inboxCollision.service';
import { blockedAddresses } from './emailVerification.service';

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
  /**
   * Recipients dropped because another property already owns their inbox.
   *
   * Carried out of triage rather than left as a count, because the count alone is useless:
   * "1 duplicate address" tells nobody which house is not being mailed. Every entry here
   * where the property differs from the one that kept the inbox is a house this push does
   * not write to — `laterCohort` says a future wave COULD reach it, but only if that wave
   * is pushed as its own campaign, which C4–C7 currently is not.
   */
  heldSharedInbox: Array<{
    email: string;
    propertyId: string;
    cohort: string;
    reason: string;
    laterCohort: boolean;
  }>;
  skipped: {
    noEmail: number;
    suppressed: number;
    holdout: number;
    alreadyInCampaign: number;
    duplicateAddress: number;
    /**
     * Refused because the verifier says the mailbox is dead or hostile.
     *
     * Its own number, not folded into 'suppressed': a suppression is the homeowner's
     * decision and a failed verification is a fact about a mailbox, and the two lead
     * somewhere different — one is final, the other is worth re-checking after a trace.
     */
    failedVerification: number;
    /**
     * Addresses held by the surname review (Frank, second email §7).
     *
     * Counted separately from 'suppressed' because it means something different and leads
     * somewhere different: a suppression is final, a held address is waiting for a person
     * to say whether it belongs to the insured. Folding it in would hide a queue that
     * somebody has to work through before these accounts can ever send.
     */
    nameReview: number;
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
 * Is the holdout in force?
 *
 * Off unless `holdout_active` is explicitly 'true'. Defaulting to off is the right way round
 * for exactly one reason: §1.9 is the standing instruction today, and a config key that has
 * never been set must express the instruction rather than the opposite of it. Wave two turns
 * it on deliberately, which is a decision somebody makes rather than a default nobody chose.
 */
async function isHoldoutActive(): Promise<boolean> {
  try {
    const rows = await pool.query(`SELECT "value" FROM "AppConfig" WHERE "key" = 'holdout_active'`);
    return String(rows.rows[0]?.value ?? '').trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

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
  holdoutActive: boolean,
): string | null {
  /**
   * ── The holdout does NOT apply in wave one (Frank, §1.9) ─────────────────
   *
   * "No holdout group in wave one. We get two directional reads for free: rated against
   *  unrated, and C5 against C6 ... A proper holdout is the only clean measure of what the
   *  band price itself is worth, and we'll run one in wave two."
   *
   * That sits under "1 · Decisions — These are settled. Build to them." This line refused
   * 85 Grade A accounts inside C1–C7 that the send list had already counted and dealt test
   * arms to, so the list promised 850 and the push would have delivered 765 — against an
   * instruction that says the holdout should not exist yet.
   *
   * The FLAG is deliberately left on the record. The assignment is a stable hash of the lead
   * id and holdoutAssignedAt is the evidence a lead went through the process; wave two needs
   * both, and clearing them to solve a wave-one problem would destroy the control group
   * before it is used. The rule is switched off, not the data.
   *
   * Set the AppConfig key `holdout_active` to 'true' to bring it back for wave two.
   */
  if (lead.holdoutFlag === true && holdoutActive) return 'holdout';
  if (lead.hardBounced === true) return 'suppressed';
  if (lead.campaignUnsubscribedAt) return 'suppressed';
  if (String(lead.campaignStatus ?? '') === 'suppressed') return 'suppressed';
  if (sup.households.has(householdScopeKey(lead))) return 'suppressed';
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
  const leads = await getLeadsFromDb({ ...filters, limit: 100000, orderBy: 'xdate', withTraceData: true });
  // One query for the whole triage — a lookup per candidate would be thousands.
  const blockedEmails = await blockedAddresses();

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
  const holdoutActive = await isHoldoutActive();
  /**
   * ── The surname hold (Frank, second email §7) ────────────────────────────
   *
   * "A surname match between every skip-trace-recovered address and the insured or
   *  co-insured. Failures go to a review list, not into a send."
   *
   * Loaded once, like the suppressions, because a push covers thousands of leads. An
   * address in this set has a review row that nobody has approved — the account that
   * prompted the rule had insured Claudia Garcia and one recovered address reading
   * dburnette19@gmail.com, and sending there discloses a stranger's property details and
   * estimated premium from a domain with no history to absorb the complaint.
   *
   * Frank on why verification does not cover this: "It confirms a mailbox exists, not that
   * it belongs to the person. It will pass this address and the send will still be wrong."
   */
  const held = await heldAddresses();

  const mode: RecipientMode = opts.recipients ?? 'insured';

  const skipped = {
    noEmail: 0, suppressed: 0, holdout: 0, alreadyInCampaign: 0, duplicateAddress: 0,
    failedVerification: 0,
    nameReview: 0,
  };
  const eligible: Recipient[] = [];
  // One address gets one send, even when two leads share it (a couple owning two
  // properties, or a landlord). That is resolved AFTER this loop by
  // resolveInboxCollisions, so the choice is made by a stated rule rather than by
  // whichever row Postgres happened to return first.

  // Counted for all three modes in this one pass, so the dialog's chips agree with each
  // other and with whatever is actually pushed.
  const byMode = { insured: 0, coinsured: 0, both: 0 };
  const leadsByMode = { insured: 0, coinsured: 0, both: 0 };

  for (const lead of leads) {
    const suppress = suppressionReason(lead, sup, holdoutActive);
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
    /**
     * Every address for each person, not just the best one.
     *
     * Frank, 28 Sep: "individual emails sent to each of the insured's verified emails — we
     * are not sure which will be primary so we must outreach all." The send list was changed
     * for that; this was not, so the two disagreed about who a cohort contains — the list
     * offering every address and the push offering one, a difference invisible until a
     * forecast is compared against what actually went out.
     */
    const insAll = allInsuredAddresses(lead, signals);
    const coAll = allCoInsuredAddresses(lead, signals);
    /**
     * Address-scope suppressions applied to the chosen address, not to the lead.
     *
     * A mailbox suppressed on its own account (a hard bounce, or an opt-out that named
     * only that address) is dropped here. If the person's other address survives ranking
     * the lead still goes — which is the difference between "this mailbox is dead" and
     * "this household said stop".
     */
    const usable = (e: string | undefined) => !!e && !sup.emails.has(e.toLowerCase().trim());
    /** Held for surname review — not a suppression, and counted apart from one. */
    const onHold = (e: string | undefined) => !!e && held.has(e.toLowerCase().trim());

    /**
     * Held and suppressed are decided PER ADDRESS now, not per person.
     *
     * With one address each, "the insured is held" and "this address is held" were the same
     * statement. They are not any more: a card whose first address is in the surname review
     * may have a second that is not, and dropping the person for the first one would lose
     * reach the review was never asked about.
     */
    const keep = (list: typeof insAll) => {
      const out: string[] = [];
      for (const a of list) {
        if (!usable(a.email)) continue;
        if (onHold(a.email)) { skipped.nameReview++; continue; }
        out.push(a.email);
      }
      return out;
    };
    const ins = keep(insAll);
    const co = keep(coAll);

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
      // The verifier's verdict, applied here as well as on the list — the push is the last
      // gate before a homeowner is written to, and it must not rely on the list having run.
      if (blockedEmails.has(c.email)) { skipped.failedVerification++; continue; }
      eligible.push(c);
    }
    // "No email" means no address FOR THE SELECTED PEOPLE — a card with only a
    // co-insured address genuinely has nothing to send to under an insured-only push.
    if (!gotOne) skipped.noEmail++;
  }

  /**
   * ── One inbox, one contact ────────────────────────────────────────────────
   *
   * The platform keys a contact by EMAIL ADDRESS, so two recipients sharing an address are
   * one contact there, carrying one set of custom variables. Three addresses on the current
   * send list are shared between different properties — a homeowner with two houses, and
   * two neighbours on one inbox.
   *
   * This used to be a `seenAddresses` set inside the loop above: first one wins, where
   * "first" meant the order the rows came back from Postgres. That is safe — no wrong data
   * is sent — but it silently picked which of a man's two houses he would ever hear about,
   * it picked differently whenever the query plan changed, and it reported the loser as a
   * bare count with no way to find out who it was.
   *
   * The rule now lives in one place and the export uses the same one, so a hand-uploaded
   * CSV and an API push cannot disagree about which house owns the inbox.
   */
  const resolved = resolveInboxCollisions(eligible, (c) => ({
    email: c.email,
    renewalDate: String(c.lead.effectiveDate ?? '').slice(0, 10),
    role: c.personRole === 'insured' ? 'insured' : 'coInsured',
    propertyId: String(c.lead.propertyId ?? ''),
    cohort: String(c.lead.cohort ?? ''),
  }));
  skipped.duplicateAddress = resolved.held.length;

  return {
    matching: leads.length,
    eligible: resolved.keep,
    heldSharedInbox: resolved.held.map((h) => ({
      email: h.row.email,
      propertyId: String(h.row.lead.propertyId ?? ''),
      cohort: String(h.row.lead.cohort ?? ''),
      reason: h.reason,
      laterCohort: h.laterCohort,
    })),
    skipped,
    byMode,
    leadsByMode,
  };
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

  /**
   * Read once for the whole batch, not per contact — 186 identical queries would be 186
   * chances for half a push to carry a booking link and half to carry none.
   */
  const site = await agencyWebsite();
  // Same for every homeowner (migration 047) — loaded once, sent with every contact.
  const globals = await globalMergeVars();

  const payload: LeadInput[] = toSend.map((r) => ({
    email: r.email,
    first_name: r.personRole === 'insured' ? (r.lead.owner1FirstName ?? undefined) : (r.lead.owner2FirstName ?? undefined),
    last_name: r.personRole === 'insured' ? (r.lead.owner1LastName ?? undefined) : (r.lead.owner2LastName ?? undefined),
    /**
     * The full set, from the one place that builds it (mergeVars.service).
     *
     * This sent five variables: property_address, renewal_date, band_low, band_high and the
     * CRM id. The CSV export sent nineteen. So a contact pushed from here rendered an email
     * with no subject line, no CTA and no month, while a contact uploaded by hand rendered
     * correctly and had no OutreachEvent row — meaning every reply it produced was matched
     * against nothing and silently dropped.
     *
     * Both paths now build their variables here, so the two cannot describe the same person
     * differently.
     */
    /**
     * customOnly, because first_name and last_name are already set above through the API's
     * own fields. Sending them again here would hand the platform two variables called
     * firstName — its built-in and one of ours — and nothing would report the collision.
     */
    custom_variables: customOnly(mergeVarsFor(r.lead, r.personRole === 'insured' ? 'insured' : 'coInsured', site, globals)),
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
          /**
           * The segment and this person's test arm travel WITH the send.
           *
           * §6.1: "Segment is written to the lead record and stamped on every send and
           * every response. It is never inferred at report time." Joining back to the lead
           * later would read whatever it has become — re-graded, recaptured, re-rated —
           * rather than what was true when this message went out.
           *
           * The email step is not known here: the vendor runs the sequence and tells us
           * which step a message was on when it reports the send. So the version LABEL is
           * assembled in the webhook, once the step is known, from these stored parts.
           */
          `INSERT INTO "OutreachEvent"
             ("id","leadId","propertyId","personRole","recipientEmail","channel","vendorLeadId","vendorCampaignId","cohort","publishedBandLow","publishedBandHigh","segment","subjectVariant","ctaVariant","sentAt","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,'campaign',$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW(),NOW())`,
          [
            crypto.randomUUID(), r.lead.id, r.lead.propertyId ?? null, r.personRole, r.email,
            outcome.leadId ?? null, campaignId,
            r.lead.cohort ?? cohortOf(r.lead.effectiveDate),
            r.lead.indicativeBandLow ?? null, r.lead.indicativeBandHigh ?? null,
            (r.lead.campaignSegment as Segment | null) ?? null,
            r.personRole === 'insured'
              ? (r.lead.insuredSubjectVariant ?? null)
              : (r.lead.coInsuredSubjectVariant ?? null),
            r.personRole === 'insured'
              ? (r.lead.insuredCtaArm == null ? null : String(r.lead.insuredCtaArm))
              : (r.lead.coInsuredCtaArm == null ? null : String(r.lead.coInsuredCtaArm)),
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
