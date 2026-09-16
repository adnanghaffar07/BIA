import type { PoolClient } from 'pg';
import { deleteLead } from '@/lib/integrations/leadCampaign';

/**
 * One engagement ends outreach to the whole card.
 *
 * A card now yields several recipients — every address belonging to the named insured —
 * so stopping only the address that answered leaves the household being chased after it
 * has already replied.
 *
 * ── Why this deletes the sibling leads ───────────────────────────────────────
 * The sending platform has no way to pause or stop an individual lead. Verified against
 * the live API: /leads/{id}/pause and /leads/stop return "Route not found"; PATCH
 * /leads/{id} accepts a `status` field and silently discards it (it stayed 1 through
 * every value tried); update-interest-status only queues a background job against a
 * different field. Removing the lead from the campaign is the only mechanism that
 * provably halts sends.
 *
 * That is destructive on the vendor's side, so the CRM records the stop BEFORE calling
 * it — who was stopped, why, and which engagement triggered it. Our OutreachEvent rows
 * remain the history even though the vendor's lead is gone.
 *
 * ── Who is spared ────────────────────────────────────────────────────────────
 * Only recipients that are still live are stopped. An address that already replied,
 * bounced or unsubscribed is left alone: its outcome is real data, and re-stamping it
 * would overwrite the reason it actually ended.
 */

export type HouseholdStopResult = {
  /** Siblings the CRM marked stopped. */
  stopped: number;
  /** Siblings the platform confirmed removed — sends genuinely halted. */
  removedFromPlatform: number;
  /** Siblings the CRM stopped but the platform refused to remove. */
  failedOnPlatform: Array<{ email: string; error: string }>;
};

/**
 * @param client   an OPEN transaction — the caller commits, so a stop and the
 *                 engagement that caused it land together or not at all.
 * @param leadId   the card
 * @param keepEventId the recipient that engaged; never stopped
 */
export async function stopHousehold(
  client: PoolClient,
  leadId: string,
  keepEventId: string,
  reason: string,
  triggeredByEmail: string,
): Promise<HouseholdStopResult> {
  const { rows: siblings } = await client.query(
    `SELECT "id", "recipientEmail", "vendorLeadId"
       FROM "OutreachEvent"
      WHERE "leadId" = $1
        AND "id" <> $2
        AND "stoppedAt"      IS NULL
        AND "repliedAt"      IS NULL
        AND "bouncedAt"      IS NULL
        AND "unsubscribedAt" IS NULL`,
    [leadId, keepEventId],
  );

  if (!siblings.length) {
    return { stopped: 0, removedFromPlatform: 0, failedOnPlatform: [] };
  }

  const now = new Date();
  await client.query(
    `UPDATE "OutreachEvent"
        SET "stoppedAt" = $2, "stoppedReason" = $3, "stoppedBy" = $4, "updatedAt" = $2
      WHERE "id" = ANY($1::text[])`,
    [siblings.map((s) => s.id), now, reason, triggeredByEmail],
  );

  // Recorded first, removed second. If a removal fails the CRM still shows the address
  // as stopped and the failure is reported, which is the safe way round: a stop we
  // believe happened but did not is worse than one we know to check.
  const failed: Array<{ email: string; error: string }> = [];
  let removed = 0;
  for (const s of siblings) {
    if (!s.vendorLeadId) continue;
    try {
      await deleteLead(s.vendorLeadId);
      removed++;
    } catch (err) {
      failed.push({
        email: s.recipientEmail,
        error: err instanceof Error ? err.message : 'could not remove from the campaign',
      });
    }
  }

  return { stopped: siblings.length, removedFromPlatform: removed, failedOnPlatform: failed };
}

/**
 * Record who the household now talks to.
 *
 * Whoever answered becomes the contact — insured or co-insured. Frank's rule runs both
 * ways: if the co-insured replies, they are the primary and the insured's addresses go
 * quiet. Stored on the Lead rather than derived from events, because it has to survive
 * into the next renewal cycle.
 *
 * COALESCE, not overwrite: the FIRST person to engage owns the conversation. A later
 * automated open from another address must not silently move it.
 */
export async function setPrimaryContact(
  client: PoolClient,
  leadId: string,
  email: string,
  role: string,
  at: Date,
): Promise<void> {
  await client.query(
    `UPDATE "Lead"
        SET "primaryContactEmail" = COALESCE("primaryContactEmail", $2),
            "primaryContactRole"  = COALESCE("primaryContactRole", $3),
            "primaryContactAt"    = COALESCE("primaryContactAt", $4),
            "updatedAt" = $4
      WHERE "id" = $1`,
    [leadId, email, role, at],
  );
}
