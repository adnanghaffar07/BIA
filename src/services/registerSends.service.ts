import { sql } from '@/lib/neon';
import { bestInsuredAddress, bestCoInsuredAddress } from './addressRank.service';
import { heldAddresses } from './emailNameReview.service';
import { type Segment } from './campaignSegment.service';

/**
 * Register the sends for a list that is uploaded to the platform by hand.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A reply arrives as an address and an event, nothing more. The webhook finds the CRM record
 * by looking that address up in OutreachEvent; with no row, it answers `matched: false` and
 * the reply is gone. Nothing errors, nothing is logged, and the first anyone knows is a
 * homeowner who replied and never heard back.
 *
 * campaignPush writes those rows as it hands each contact over, which is why pushing keeps
 * the loop closed. Uploading a CSV does not — the file carries the right people but creating
 * a file is not the same as recording a send.
 *
 * This closes that gap: it writes the same rows ahead of the upload, so the addresses are
 * already known when the first reply comes back.
 *
 * ── What it does NOT claim ──────────────────────────────────────────────────
 * `sentAt` stays NULL. A registered row means "this person is on the list and here is who
 * they are" — not "we sent to them". The platform's own sent event stamps the time, the
 * mailbox and the step. Writing a send time here would put a number into every report that
 * described an email nobody had posted yet.
 *
 * ── Why the campaign id is optional ─────────────────────────────────────────
 * It is usually not known until after the upload. The webhook matches on the address and
 * only PREFERS a campaign match, then stamps the id onto the row from the first event that
 * carries one. Supplying it here is better when it is known; leaving it out still works.
 */

export type RegisterResult = {
  considered: number;
  registered: number;
  alreadyRegistered: number;
  heldSkipped: number;
  byCohort: Array<{ cohort: string; n: number }>;
};

export async function registerSends(params: {
  effFrom: string;
  effTo: string;
  campaignId?: string | null;
  dryRun?: boolean;
  /**
   * Specific leads, instead of a cohort range.
   *
   * The range form deliberately requires sendListBuiltAt, so nothing off the send list can be
   * registered by accident. A named lead is somebody asking for that one on purpose — a test
   * harness, or a single account added late — and it must not need the send list to qualify.
   */
  leadIds?: string[];
}): Promise<RegisterResult> {
  const { effFrom, effTo, campaignId = null, dryRun = true, leadIds } = params;

  const held = await heldAddresses();
  const leads = leadIds?.length
    ? await sql`SELECT * FROM "Lead" WHERE "id" = ANY(${leadIds}::text[])` as Array<Record<string, any>>
    : await sql`
        SELECT * FROM "Lead"
         WHERE "sendListBuiltAt" IS NOT NULL AND "cohort" BETWEEN ${effFrom} AND ${effTo}
         ORDER BY "cohort"` as Array<Record<string, any>>;

  const out: RegisterResult = {
    considered: 0, registered: 0, alreadyRegistered: 0, heldSkipped: 0, byCohort: [],
  };
  const perCohort = new Map<string, number>();

  for (const l of leads) {
    const people: Array<['insured' | 'coinsured', string, 'A' | 'B' | null, number | null]> = [];
    const ins = bestInsuredAddress(l);
    const co = bestCoInsuredAddress(l);
    if (ins?.email) people.push(['insured', ins.email, l.insuredSubjectVariant ?? null, l.insuredCtaArm ?? null]);
    if (co?.email) people.push(['coinsured', co.email, l.coInsuredSubjectVariant ?? null, l.coInsuredCtaArm ?? null]);

    for (const [role, rawEmail, variant, arm] of people) {
      const email = String(rawEmail).trim().toLowerCase();
      if (held.has(email)) { out.heldSkipped++; continue; }
      out.considered++;

      /**
       * One row per person per campaign. The unique index only covers rows that carry an
       * email step, and these do not yet — so the check is explicit rather than relying on
       * ON CONFLICT, and a second run adds nothing.
       */
      const existing = await sql`
        SELECT "id" FROM "OutreachEvent"
         WHERE "leadId" = ${String(l.id)} AND "personRole" = ${role}
           AND lower("recipientEmail") = ${email}
         LIMIT 1` as Array<{ id: string }>;
      if (existing.length) { out.alreadyRegistered++; continue; }

      perCohort.set(String(l.cohort), (perCohort.get(String(l.cohort)) ?? 0) + 1);
      if (dryRun) { out.registered++; continue; }

      await sql`
        INSERT INTO "OutreachEvent"
          ("id","leadId","propertyId","personRole","recipientEmail","channel",
           "vendorCampaignId","cohort","segment","subjectVariant","ctaVariant",
           "publishedBandLow","publishedBandHigh","sentAt","createdAt","updatedAt")
        VALUES (${crypto.randomUUID()}, ${String(l.id)}, ${l.propertyId ?? null}, ${role},
                ${email}, 'campaign', ${campaignId}, ${l.cohort ?? null},
                ${(l.campaignSegment ?? null) as Segment | null},
                ${variant}, ${arm == null ? null : String(arm)},
                -- No band is published, because none exists that a producer produced.
                NULL, NULL,
                /**
                 * sentAt EXPLICITLY NULL. The column carries DEFAULT now(), so leaving it
                 * out of the insert stamps a send time — and every one of these rows would
                 * then claim an email that has not been written yet. Delivered is derived as
                 * sent-and-not-bounced, so the dashboard would have reported 186 sends and
                 * 186 deliveries on a campaign still sitting in draft.
                 *
                 * The platform's own sent event fills this in, with the time it really went.
                 */
                NULL, NOW(), NOW())`;
      out.registered++;
    }
  }

  out.byCohort = [...perCohort].sort().map(([cohort, n]) => ({ cohort, n }));
  return out;
}

/** How many people on the list the CRM could currently match a reply for. */
export async function registrationCoverage(params: { effFrom: string; effTo: string }): Promise<{
  onList: number; registered: number; unregistered: number;
}> {
  const [r] = await sql`
    SELECT COUNT(*)::int AS on_list,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "OutreachEvent" e WHERE e."leadId" = l."id"))::int AS registered
      FROM "Lead" l
     WHERE l."sendListBuiltAt" IS NOT NULL
       AND l."cohort" BETWEEN ${params.effFrom} AND ${params.effTo}` as Array<Record<string, any>>;
  return {
    onList: Number(r?.on_list ?? 0),
    registered: Number(r?.registered ?? 0),
    unregistered: Number(r?.on_list ?? 0) - Number(r?.registered ?? 0),
  };
}
