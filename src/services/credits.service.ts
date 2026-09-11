import sql from '@/lib/neon';

/**
 * Tracerfy credit balance (Frank Sep-2026).
 *
 * Tracerfy has no balance endpoint — every account/credits/usage path 404s, and a
 * lookup response carries only `credits_deducted` for that one call. So the balance
 * cannot be read; it has to be derived.
 *
 * Rather than keep a counter and decrement it — which drifts the moment a write is
 * missed, a top-up happens outside the CRM, or someone traces from a script — this
 * stores a CHECKPOINT and computes the rest:
 *
 *     remaining = balance at checkpoint − (15 × hits recorded since the checkpoint)
 *
 * Spend is counted from the traces themselves, so the figure re-derives from the
 * database every time and cannot silently fall out of step. Topping up is just a new
 * checkpoint with today's date.
 *
 * A miss costs nothing, which is why only hits are counted.
 */

const CREDITS_PER_HIT = 15;

const KEY_BALANCE = 'tracerfy_balance_at_checkpoint';
const KEY_CHECKPOINT_AT = 'tracerfy_balance_checkpoint_at';
const KEY_LOW_THRESHOLD = 'tracerfy_low_credit_threshold';

/** Default "low" line. Overridable via AppConfig without a deploy. */
const DEFAULT_LOW_THRESHOLD = 1000;

export type CreditStatus = {
  /** False when no checkpoint has been entered — we then say nothing rather than guess. */
  known: boolean;
  remaining: number | null;
  spentSinceCheckpoint: number;
  checkpointAt: string | null;
  threshold: number;
  low: boolean;
  /** Enough for roughly this many more matches. */
  matchesRemaining: number | null;
};

async function readConfig(key: string): Promise<string | null> {
  const rows = await sql`SELECT "value" FROM "AppConfig" WHERE "key" = ${key}` as any[];
  return rows[0]?.value ?? null;
}

async function writeConfig(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO "AppConfig" ("key", "value", "updatedAt") VALUES (${key}, ${value}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()`;
}

/** Record the balance shown in the Tracerfy dashboard right now. */
export async function setCreditCheckpoint(balance: number, at: Date = new Date()): Promise<void> {
  await writeConfig(KEY_BALANCE, String(Math.max(0, Math.floor(balance))));
  await writeConfig(KEY_CHECKPOINT_AT, at.toISOString());
}

export async function setLowThreshold(n: number): Promise<void> {
  await writeConfig(KEY_LOW_THRESHOLD, String(Math.max(0, Math.floor(n))));
}

export async function getCreditStatus(): Promise<CreditStatus> {
  const [balanceRaw, checkpointRaw, thresholdRaw] = await Promise.all([
    readConfig(KEY_BALANCE),
    readConfig(KEY_CHECKPOINT_AT),
    readConfig(KEY_LOW_THRESHOLD),
  ]);

  const threshold = Number(thresholdRaw) > 0 ? Number(thresholdRaw) : DEFAULT_LOW_THRESHOLD;

  // No checkpoint entered yet. Say nothing rather than invent a number — a wrong
  // "credits are low" is worse than no warning, because it gets ignored.
  if (balanceRaw === null || checkpointRaw === null) {
    return {
      known: false, remaining: null, spentSinceCheckpoint: 0,
      checkpointAt: null, threshold, low: false, matchesRemaining: null,
    };
  }

  // Count hits since the checkpoint. skipTraceData->>'hit' is the vendor's own word
  // for "we charged you", so this counts real charges rather than attempts.
  const rows = await sql`
    SELECT COUNT(*)::int AS hits
    FROM "Lead"
    WHERE ("skipTraceData"->>'hit') = 'true'
      AND "deepSkipTracedAt" IS NOT NULL
      AND "deepSkipTracedAt" >= ${checkpointRaw}::timestamp` as any[];

  const spentSinceCheckpoint = (rows[0]?.hits ?? 0) * CREDITS_PER_HIT;
  const remaining = Math.max(0, Number(balanceRaw) - spentSinceCheckpoint);

  return {
    known: true,
    remaining,
    spentSinceCheckpoint,
    checkpointAt: String(checkpointRaw).slice(0, 10),
    threshold,
    low: remaining <= threshold,
    matchesRemaining: Math.floor(remaining / CREDITS_PER_HIT),
  };
}
