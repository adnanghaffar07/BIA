import crypto from 'crypto';
import { pool } from '@/lib/neon';
import type { CtaKey } from '@/lib/ctaToken';
import { CTAS } from '@/lib/ctaToken';
import { stopHousehold, setPrimaryContact } from './householdStop.service';

/**
 * What each of the six §05 buttons does to the lead.
 *
 * Arrivals and effects are deliberately separated. A click is RECORDED the moment the link
 * is opened, but nothing is acted on until the browser confirms — scanners prefetch links,
 * and for "No thanks" and "This is not my property" acting on a prefetch would permanently
 * silence a homeowner who never touched the email.
 */

/** Everything a disposition needs to know. */
export type CtaContext = {
  leadId: string;
  cta: CtaKey;
  campaignId?: string | null;
  step?: number | null;
  payload?: Record<string, unknown> | null;
  userAgent?: string | null;
  ip?: string | null;
};

/** Raw IPs are not stored. A salted hash is enough to spot a scanner storm. */
function hashIp(ip?: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(`bia-cta:${ip}`).digest('hex').slice(0, 32);
}

/** Record the arrival. Always. This is the denominator for everything in §05. */
export async function recordCtaArrival(ctx: CtaContext): Promise<string> {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `SELECT "cohort" FROM "Lead" WHERE "id" = $1`,
    [ctx.leadId],
  );
  await pool.query(
    `INSERT INTO "CtaResponse"
       ("id","leadId","cta","confirmed","campaignId","emailStep","cohort","payload","userAgent","ipHash")
     VALUES ($1,$2,$3,FALSE,$4,$5,$6,$7,$8,$9)`,
    [
      id, ctx.leadId, ctx.cta, ctx.campaignId ?? null, ctx.step ?? null,
      rows[0]?.cohort ?? null,
      ctx.payload ? JSON.stringify(ctx.payload) : null,
      String(ctx.userAgent ?? '').slice(0, 300) || null,
      hashIp(ctx.ip),
    ],
  );
  return id;
}

export type ConfirmResult = {
  applied: boolean;
  disposition: string;
  /** Plain-English summary of what changed, for the activity feed and the response. */
  summary: string;
  householdStopped: number;
};

/**
 * Confirm a click and apply its disposition.
 *
 * Idempotent by design: every write is guarded, so a double-tap or a page refresh cannot
 * suppress twice, stop a household twice, or stack tasks. The CtaResponse row is marked
 * confirmed first, and a row already confirmed short-circuits.
 */
export async function confirmCta(
  responseId: string,
  extraPayload?: Record<string, unknown> | null,
): Promise<ConfirmResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim the row. A second confirm finds nothing to claim and does no work.
    const { rows: claimed } = await client.query(
      `UPDATE "CtaResponse"
          SET "confirmed" = TRUE,
              "confirmedAt" = NOW(),
              "payload" = COALESCE($2::jsonb, "payload")
        WHERE "id" = $1 AND "confirmed" = FALSE
        RETURNING "leadId", "cta", "campaignId", "payload"`,
      [responseId, extraPayload ? JSON.stringify(extraPayload) : null],
    );
    if (!claimed.length) { await client.query('ROLLBACK'); return null; }

    const { leadId, cta, campaignId, payload } = claimed[0] as {
      leadId: string; cta: CtaKey; campaignId: string | null; payload: Record<string, unknown> | null;
    };
    const spec = CTAS[cta];
    const now = new Date();
    // Explicitly string: CTAS is `as const`, so an inferred type would be the literal
    // label union and every reassignment below would fail to typecheck.
    let summary: string = spec.label;
    let householdStopped = 0;

    /**
     * Any response ends the conversation for the whole card.
     *
     * §04: "Any response suppresses the household. A reply or click from either party
     * immediately stops sends to the other. Emailing the husband while Ruben is on the
     * phone with the wife is an unforced error."
     *
     * Applied to every CTA including "No thanks" — especially "No thanks".
     */
    const { rows: anyEvent } = await client.query(
      `SELECT "id", "recipientEmail", "personRole" FROM "OutreachEvent"
        WHERE "leadId" = $1 ORDER BY "sentAt" DESC NULLS LAST LIMIT 1`,
      [leadId],
    );
    if (anyEvent.length) {
      const stop = await stopHousehold(client, leadId, anyEvent[0].id, `cta_${cta}`, anyEvent[0].recipientEmail);
      householdStopped = stop.stopped;
      // A positive signal makes that address the household's contact; a rejection never does.
      if (cta === 'quote' || cta === 'savings') {
        await setPrimaryContact(client, leadId, anyEvent[0].recipientEmail, anyEvent[0].personRole ?? 'insured', now);
      }
      await client.query(
        `UPDATE "OutreachEvent"
            SET "clickedAt" = COALESCE("clickedAt", $2), "ctaAction" = COALESCE("ctaAction", $3), "updatedAt" = $2
          WHERE "id" = $1`,
        [anyEvent[0].id, now, cta],
      );
    }

    switch (cta) {
      case 'quote':
      case 'savings':
        // Intent. The lead becomes engaged and Ruben owns it from here; the SLA clock is
        // read from CtaResponse.confirmedAt rather than stored, so it cannot drift.
        await client.query(
          `UPDATE "Lead"
              SET "campaignStatus" = 'engaged',
                  "campaignRepliedAt" = COALESCE("campaignRepliedAt", $2),
                  "updatedAt" = $2
            WHERE "id" = $1`,
          [leadId, now],
        );
        summary = `${spec.label} — ${spec.disposition}, respond within ${spec.slaMinutes} minutes`;
        break;

      case 'defer': {
        // "Captures the date, schedules a task, exits the sequence cleanly."
        const when = String(payload?.renewalDate ?? '').slice(0, 10);
        const valid = /^\d{4}-\d{2}-\d{2}$/.test(when) ? when : null;
        await client.query(
          `UPDATE "Lead"
              SET "revisitFlag" = TRUE,
                  "revisitDate" = COALESCE($3, "revisitDate"),
                  "revisitNote" = COALESCE("revisitNote", 'Asked to be contacted before renewal (CTA)'),
                  "campaignStatus" = 'suppressed',
                  "suppressedReason" = COALESCE("suppressedReason", 'cta_defer'),
                  "updatedAt" = $2
            WHERE "id" = $1`,
          [leadId, now, valid],
        );
        summary = valid
          ? `${spec.label} — revisit ${valid}`
          : `${spec.label} — no date given, flagged for revisit`;
        break;
      }

      case 'roof': {
        // A CLAIM, not a measurement: we are told the roof is recent, not which year.
        // Writing a year we were never given would turn a guess into a fact that later
        // reads as verified data. "PROMOTE TO VERIFY · never downgrades."
        const year = Number(payload?.roofYear);
        const plausible = Number.isInteger(year) && year >= new Date().getFullYear() - 15 && year <= new Date().getFullYear();
        await client.query(
          `UPDATE "Lead"
              SET "roofRecentClaim" = TRUE,
                  "roofRecentClaimAt" = $2,
                  "roofYear" = COALESCE("roofYear", $3),
                  "updatedAt" = $2
            WHERE "id" = $1`,
          [leadId, now, plausible ? year : null],
        );
        summary = plausible
          ? `${spec.label} — roof year ${year} recorded`
          : `${spec.label} — claim recorded, year not supplied`;
        break;
      }

      case 'no_thanks':
        // "A visible, non-punitive 'no' keeps people from reaching for report-spam."
        // Global and permanent — the whole point is that it is more attractive than the
        // spam button, and it is only more attractive if it actually works.
        await client.query(
          `UPDATE "Lead"
              SET "campaignStatus" = 'suppressed',
                  "suppressedReason" = COALESCE("suppressedReason", 'cta_opt_out'),
                  "campaignUnsubscribedAt" = COALESCE("campaignUnsubscribedAt", $2),
                  "doNotRevisit" = TRUE,
                  "updatedAt" = $2
            WHERE "id" = $1`,
          [leadId, now],
        );
        summary = `${spec.label} — suppressed permanently`;
        break;

      case 'not_mine':
        // The only direct measurement of person-match accuracy that exists. Also
        // suppresses: someone who says the property is not theirs must not be mailed again.
        await client.query(
          `UPDATE "Lead"
              SET "personMatchBad" = TRUE,
                  "personMatchBadAt" = $2,
                  "campaignStatus" = 'suppressed',
                  "suppressedReason" = COALESCE("suppressedReason", 'cta_not_my_property'),
                  "updatedAt" = $2
            WHERE "id" = $1`,
          [leadId, now],
        );
        summary = `${spec.label} — flagged as a person-match failure and suppressed`;
        break;
    }

    await client.query(
      `INSERT INTO "Activity" ("id","leadId","type","content","metadata","createdBy","createdAt")
       VALUES (gen_random_uuid()::text, $1, 'cta_response', $2, $3, 'homeowner (email CTA)', $4)`,
      [
        leadId,
        summary + (householdStopped ? ` — outreach stopped to ${householdStopped} other address${householdStopped === 1 ? '' : 'es'}` : ''),
        JSON.stringify({ cta, disposition: spec.disposition, campaignId, householdStopped }),
        now,
      ],
    );

    await client.query('COMMIT');
    return { applied: true, disposition: spec.disposition, summary, householdStopped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
