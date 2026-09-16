import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/neon';
import {
  WEBHOOK_HEADER, verifyWebhookSecret, classifyEvent, readPayload, cleanReplyExcerpt, htmlToText,
} from '@/lib/integrations/campaignWebhook';
import { stopHousehold, setPrimaryContact, type HouseholdStopResult } from '@/services/householdStop.service';

/**
 * POST /api/webhooks/campaign — outcomes from the campaign platform.
 *
 * This is what makes the integration live instead of something a producer has to go
 * and check in the vendor's dashboard.
 *
 * Three policies worth stating, because each one is a deliberate choice:
 *
 *  1. AUTH — the vendor does not sign payloads, so a shared secret arrives on the
 *     `x-bia-campaign-key` header and is compared in constant time. Unconfigured in
 *     production means refuse, not allow.
 *
 *  2. NO MATCH IS NOT AN ERROR — a payload we cannot tie to a local row is
 *     acknowledged with 200 and `matched: false`. It usually means the lead was added
 *     directly in the vendor's dashboard and never touched this CRM. Returning an
 *     error there would make the vendor retry forever over something that is working
 *     as intended. Nothing is ever created speculatively: we only update outcomes for
 *     sends this CRM actually initiated.
 *
 *  3. REAL FAILURES RETURN 5xx — so the vendor's own retry re-delivers later. An
 *     unrecognised event type is acknowledged and ignored; a database error is not.
 *
 * This route is public by necessity (the vendor cannot authenticate as a CRM user),
 * so it must stay on the middleware's PUBLIC_PATHS list while the header check above
 * carries the whole security burden.
 */

/** Never let a webhook hang a vendor retry loop, and stay inside the smallest
 *  Vercel function limit so this cannot fail to build on a lower plan. */
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  // ── auth ──────────────────────────────────────────────────────────────────
  if (!verifyWebhookSecret(request.headers.get(WEBHOOK_HEADER))) {
    // Deliberately terse: an attacker probing the endpoint learns nothing about
    // whether the header was missing, wrong length, or simply wrong.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON will never become valid on a retry — acknowledge and drop.
    return NextResponse.json({ ok: true, matched: false, reason: 'unparseable body' });
  }

  const p = readPayload(body);
  const kind = classifyEvent(p.eventType);

  // Unrecognised event type: acknowledge, write nothing. The vendor sends types we
  // have no opinion on, and erroring on them would trigger pointless retries.
  //
  // 'sent' USED to be discarded here alongside them. It is now handled: it is the only
  // event that carries which mailbox the platform chose and what the copy said, and a
  // per-mailbox or per-content report has no other live source for either.
  if (!kind) {
    return NextResponse.json({ ok: true, matched: false, event: p.eventType ?? null, handled: false });
  }
  if (!p.email) {
    return NextResponse.json({ ok: true, matched: false, reason: 'no recipient in payload' });
  }

  const client = await pool.connect();
  try {
    // ── find the row this event is about ─────────────────────────────────────
    // Campaign id narrows it when present, but is not required: a payload missing it
    // should still land on the right row rather than be discarded.
    const { rows: found } = await client.query(
      `SELECT "id", "leadId", "openCount", "personRole"
         FROM "OutreachEvent"
        WHERE lower("recipientEmail") = $1
          AND ($2::text IS NULL OR "vendorCampaignId" = $2)
        ORDER BY "vendorCampaignId" IS NOT DISTINCT FROM $2 DESC, "sentAt" DESC NULLS LAST
        LIMIT 1`,
      [p.email, p.campaignId],
    );

    if (!found.length) {
      return NextResponse.json({ ok: true, matched: false, event: p.eventType, email: p.email });
    }
    const row = found[0];
    const now = new Date();

    // Outcome row + parent lead move together: a reply recorded on one but not the
    // other is exactly how a suppressed lead gets mailed again.
    await client.query('BEGIN');

    let leadPatch: { sql: string; params: any[] } | null = null;

    if (kind === 'reply') {
      await client.query(
        `UPDATE "OutreachEvent"
            SET "repliedAt" = COALESCE("repliedAt", $2), "replyExcerpt" = COALESCE("replyExcerpt", $3), "updatedAt" = $2
          WHERE "id" = $1`,
        [row.id, now, cleanReplyExcerpt(p.replyText)],
      );
      // A reply is engagement: stop the sequence for this household.
      leadPatch = {
        sql: `UPDATE "Lead"
                 SET "campaignRepliedAt" = COALESCE("campaignRepliedAt", $2),
                     "campaignStatus" = 'engaged', "updatedAt" = $2
               WHERE "id" = $1`,
        params: [row.leadId, now],
      };
    } else if (kind === 'bounce') {
      const hard = String(p.bounceType ?? '').toLowerCase().includes('hard')
        || /(does not exist|no such user|unknown recipient|550)/i.test(String(p.bounceReason ?? ''));
      await client.query(
        `UPDATE "OutreachEvent"
            SET "bouncedAt" = COALESCE("bouncedAt", $2), "bounceType" = COALESCE("bounceType", $3),
                "bounceReason" = COALESCE("bounceReason", $4), "updatedAt" = $2
          WHERE "id" = $1`,
        [row.id, now, hard ? 'hard' : (p.bounceType ?? 'soft'), p.bounceReason],
      );
      // Only a HARD bounce suppresses. A soft bounce is a full mailbox or a transient
      // server problem, and writing the address off for that would be wrong.
      leadPatch = hard
        ? {
            sql: `UPDATE "Lead"
                     SET "campaignBouncedAt" = COALESCE("campaignBouncedAt", $2),
                         "hardBounced" = TRUE, "campaignStatus" = 'suppressed',
                         "suppressedReason" = COALESCE("suppressedReason", 'hard_bounce'), "updatedAt" = $2
                   WHERE "id" = $1`,
            params: [row.leadId, now],
          }
        : {
            sql: `UPDATE "Lead" SET "campaignBouncedAt" = COALESCE("campaignBouncedAt", $2), "updatedAt" = $2 WHERE "id" = $1`,
            params: [row.leadId, now],
          };
    } else if (kind === 'unsubscribe') {
      await client.query(
        `UPDATE "OutreachEvent" SET "unsubscribedAt" = COALESCE("unsubscribedAt", $2), "updatedAt" = $2 WHERE "id" = $1`,
        [row.id, now],
      );
      leadPatch = {
        sql: `UPDATE "Lead"
                 SET "campaignUnsubscribedAt" = COALESCE("campaignUnsubscribedAt", $2),
                     "campaignStatus" = 'suppressed',
                     "suppressedReason" = COALESCE("suppressedReason", 'unsubscribe'), "updatedAt" = $2
               WHERE "id" = $1`,
        params: [row.leadId, now],
      };
    } else if (kind === 'complaint') {
      await client.query(
        `UPDATE "OutreachEvent" SET "complainedAt" = COALESCE("complainedAt", $2), "updatedAt" = $2 WHERE "id" = $1`,
        [row.id, now],
      );
      leadPatch = {
        sql: `UPDATE "Lead"
                 SET "campaignStatus" = 'suppressed',
                     "suppressedReason" = COALESCE("suppressedReason", 'complaint'), "updatedAt" = $2
               WHERE "id" = $1`,
        params: [row.leadId, now],
      };
    } else if (kind === 'open') {
      // First open stamps the time; every open increments the counter.
      await client.query(
        `UPDATE "OutreachEvent"
            SET "openedAt" = COALESCE("openedAt", $2), "openCount" = "openCount" + 1, "updatedAt" = $2
          WHERE "id" = $1`,
        [row.id, now],
      );
    } else if (kind === 'sent') {
      // Nothing about the outcome — only the facts of the send itself. sentAt is already
      // stamped by the push, so this confirms rather than creates.
      await client.query(
        `UPDATE "OutreachEvent"
            SET "sentAt" = COALESCE("sentAt", $2), "emailStep" = COALESCE($3, "emailStep"), "updatedAt" = $2
          WHERE "id" = $1`,
        [row.id, now, p.step],
      );
      leadPatch = {
        sql: `UPDATE "Lead"
                 SET "campaignLastSentAt" = $2,
                     "currentEmailStep" = COALESCE($3, "currentEmailStep"),
                     "updatedAt" = $2
               WHERE "id" = $1`,
        params: [row.leadId, now, p.step],
      };
    } else if (kind === 'click') {
      await client.query(
        `UPDATE "OutreachEvent"
            SET "clickedAt" = COALESCE("clickedAt", $2), "ctaAction" = COALESCE("ctaAction", $3), "updatedAt" = $2
          WHERE "id" = $1`,
        [row.id, now, p.replyText ?? null],
      );
      // A click is engagement too — it is the hot signal the outreach plan is built on.
      leadPatch = {
        sql: `UPDATE "Lead" SET "campaignStatus" = COALESCE(NULLIF("campaignStatus",'suppressed'), 'engaged'), "updatedAt" = $2 WHERE "id" = $1`,
        params: [row.leadId, now],
      };
    }

    if (leadPatch) await client.query(leadPatch.sql, leadPatch.params);

    /**
     * ── What was sent, captured from whichever event happens to carry it ──────
     * Tried on EVERY matched event, not only 'sent'. The vendor is inconsistent about
     * which payloads include the sending mailbox and the copy, so taking it wherever it
     * appears is the difference between a populated column and an empty one.
     *
     * COALESCE throughout: first write wins. The campaign's sequence can be edited after
     * the fact, so a later event carrying today's copy must not overwrite the copy this
     * person actually received.
     */
    if (p.sendingMailbox || p.subject || p.bodyHtml) {
      await client.query(
        `UPDATE "OutreachEvent"
            SET "sendingMailbox"    = COALESCE("sendingMailbox", $2),
                "emailSubject"      = COALESCE("emailSubject", $3),
                "emailBody"         = COALESCE("emailBody", $4),
                "contentCapturedAt" = COALESCE("contentCapturedAt", $5),
                "updatedAt" = $5
          WHERE "id" = $1`,
        [row.id, p.sendingMailbox, p.subject, htmlToText(p.bodyHtml), now],
      );
    }

    /**
     * ── Household stop ────────────────────────────────────────────────────────
     * One answer ends the conversation for the whole card. A reply, a click on a CTA
     * or an unsubscribe/complaint from ANY address means every other address on that
     * property stops receiving the sequence, in the same transaction as the event that
     * caused it.
     *
     * Whoever engaged becomes the primary contact — the rule runs both ways, so a
     * co-insured who replies owns the conversation and the insured's addresses go
     * quiet, exactly as it would in reverse.
     *
     * An open is deliberately NOT a stop. Opens fire from scanners and prefetchers and
     * are the least trustworthy signal there is; stopping a household on one would
     * silently kill live outreach on a false positive.
     */
    let household: HouseholdStopResult | null = null;
    if (kind === 'reply' || kind === 'click' || kind === 'unsubscribe' || kind === 'complaint') {
      household = await stopHousehold(client, row.leadId, row.id, kind, p.email);

      // Only a positive signal makes someone the contact. An unsubscribe or a complaint
      // stops the household but must never mark that address as who to talk to.
      if (kind === 'reply' || kind === 'click') {
        await setPrimaryContact(client, row.leadId, p.email, row.personRole ?? 'insured', now);
      }
    }

    // Activity feed: vendor-sourced activity reads the same as anything else.
    //
    // A 'sent' gets no entry. Every recipient on every step fires one, so on a 300-lead
    // cohort with a four-step sequence that is 1,200 rows of "we emailed them" burying
    // the handful of entries a producer actually needs to see. The send is already
    // recorded on the OutreachEvent, which is where a report reads it from.
    if (kind !== 'sent') await client.query(
      `INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
       VALUES (gen_random_uuid()::text, $1, 'campaign_event', $2, 'campaign platform', $3)`,
      [
        row.leadId,
        kind === 'reply'
          ? `Replied to campaign email${p.step ? ` (step ${p.step})` : ''}`
          : kind === 'bounce'
            ? `Campaign email bounced${p.bounceReason ? ` — ${String(p.bounceReason).slice(0, 120)}` : ''}`
            : kind === 'unsubscribe'
              ? 'Unsubscribed from campaign'
              : kind === 'complaint'
                ? 'Marked a campaign email as spam'
                : kind === 'click'
                  ? `Clicked a campaign link${p.step ? ` (step ${p.step})` : ''}`
                  : `Opened a campaign email${p.step ? ` (step ${p.step})` : ''}`,
        now,
      ],
    );

    // A stop is a thing that happened to the household, so it gets its own entry
    // rather than being buried inside the reply's. Someone reading the card needs to
    // see that the other addresses were cut off, and why.
    if (household && household.stopped > 0) {
      await client.query(
        `INSERT INTO "Activity" ("id","leadId","type","content","metadata","createdBy","createdAt")
         VALUES (gen_random_uuid()::text, $1, 'campaign_event', $2, $3, 'campaign platform', $4)`,
        [
          row.leadId,
          `Outreach stopped to ${household.stopped} other address${household.stopped === 1 ? '' : 'es'} on this household`
            + ` after ${p.email} ${kind === 'reply' ? 'replied' : kind === 'click' ? 'clicked' : kind === 'unsubscribe' ? 'unsubscribed' : 'complained'}`
            + (household.failedOnPlatform.length
              ? ` — ${household.failedOnPlatform.length} could not be removed from the campaign and may still send`
              : ''),
          JSON.stringify(household),
          now,
        ],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true, matched: true, event: p.eventType, kind, leadId: row.leadId,
      household: household ?? undefined,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('POST /api/webhooks/campaign error:', err);
    // 5xx so the vendor retries — nothing was marked processed.
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  } finally {
    client.release();
  }
}
