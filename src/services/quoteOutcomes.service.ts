import { sql } from '@/lib/neon';
import { LOSS_REASONS, RE_ENGAGE_DAYS_BEFORE_RENEWAL, type LossReason } from '@/lib/lossReasons';

/**
 * Band accuracy and lost quotes (directive Sec. 10.9 and Sec. 10.6).
 *
 * Named for the outcome, not for pricing: pricing.service already exists and estimates an
 * indicative premium from property data BEFORE anyone quotes. This measures what happened
 * AFTER — what we actually quoted, whether the band held, and who beat us when it did not.
 * Two different questions, deliberately two files.
 *
 * ── Why the band has to be measured at the QUOTE, not only at the bind ──────
 * The CRM already measures accuracy when a lead binds: publishedBand* against
 * boundPremium, producing bandHit and a signed bandVariancePct. That is correct and it
 * stays.
 *
 * But it can only ever describe the leads that closed, and those are a selected sample in
 * the worst possible direction — the leads where the band was WRONG are precisely the ones
 * that walked away after seeing the real number, so they never enter the average. Measured
 * only at bind, a band that misses badly on half the book can still report 95%.
 *
 * Sec. 10.9 lists quoted_premium and quoted_carrier for exactly this reason, and the risk
 * it names is the same one: "If the band is wrong, E2 sets an expectation the quote cannot
 * meet and we lose the prospect after they raised their hand." That failure shows up at
 * quote. So accuracy is measured twice, kept in separate columns, and never averaged
 * together — they answer different questions and mixing them would hide both.
 *
 * ── Variance against the midpoint ───────────────────────────────────────────
 * Sec. 10.9 asks for "variance versus midpoint, dollars and percent". The existing
 * bind-time measure uses distance from the nearest EDGE, which answers "how far outside
 * the band did it land". Midpoint answers "how far off was our estimate" — a quote inside
 * a wide band is a hit by the first measure and can still be 20% from what we implied.
 * Both are kept. Neither is derived from the other.
 *
 * Nothing here is stored as a derived value: the gap, the percentages and the midpoints
 * are computed on read, so they cannot drift from the figures they come from.
 */

type Row = Record<string, unknown>;

/**
 * Add a year and subtract days, entirely in local calendar parts.
 *
 * NOT `new Date('2026-11-20')` — that parses as UTC midnight, and setDate/getDate then
 * operate on LOCAL components. West of UTC the instant is already the 19th locally, so the
 * arithmetic starts a day early and every re-engagement date lands a day before it should.
 * The same trap is documented in recoveryPipeline.service, where slicing a Date as a string
 * produced "Tue Aug 25".
 *
 * effectiveDate is a plain 'YYYY-MM-DD' text column with no timezone in it, so it is read
 * as three numbers and never becomes an instant at all.
 */
function renewalMinusDays(effectiveDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(effectiveDate));
  if (!m) return null;
  const [, y, mo, d] = m;
  // Local midnight, one year on. Month is 0-based; Date normalises an out-of-range day.
  const dt = new Date(Number(y) + 1, Number(mo) - 1, Number(d) - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? n : null;
};

/** Record the band Ruben produced in a carrier portal (Sec. 10.9 "At rating"). */
export async function recordBandRating(input: {
  leadId: string;
  low: number;
  high: number;
  carrier: string;
  by?: string | null;
}): Promise<void> {
  if (!(input.low > 0) || !(input.high > 0) || input.high < input.low) {
    throw new Error('A band needs a low and a high, and the high cannot be below the low.');
  }
  await sql`
    UPDATE "Lead"
       SET "indicativeBandLow" = ${input.low}, "indicativeBandHigh" = ${input.high},
           "bandCarrier" = ${input.carrier}, "bandRatedAt" = NOW(), "bandRatedBy" = ${input.by ?? null}
     WHERE "id" = ${input.leadId}`;

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${input.leadId}, 'note',
            ${`Band priced ${input.low}–${input.high} via ${input.carrier}`},
            ${input.by ?? 'crm'}, NOW())`;
}

/**
 * Record a quote, and measure the band against it.
 *
 * Measured against the band the homeowner actually READ (publishedBand*), falling back to
 * the current indicative band for a lead quoted without ever being mailed. The lead's
 * present band may have been re-rated since; the only one that set an expectation is the
 * one that went out in email 2.
 */
export async function recordQuote(input: {
  leadId: string;
  premium: number;
  carrier: string;
  by?: string | null;
}): Promise<{ bandHitAtQuote: boolean | null; varianceVsMidpointPct: number | null }> {
  const [lead] = await sql`
    SELECT "publishedBandLow","publishedBandHigh","indicativeBandLow","indicativeBandHigh"
      FROM "Lead" WHERE "id" = ${input.leadId}` as Row[];
  if (!lead) throw new Error('Lead not found');

  const low = num(lead.publishedBandLow) ?? num(lead.indicativeBandLow);
  const high = num(lead.publishedBandHigh) ?? num(lead.indicativeBandHigh);

  let hit: boolean | null = null;
  let variance: number | null = null;
  if (low != null && high != null && high > 0) {
    hit = input.premium >= low && input.premium <= high;
    const mid = (low + high) / 2;
    variance = Math.round(((input.premium - mid) / mid) * 10000) / 100;
  }

  await sql`
    UPDATE "Lead"
       SET "quotedPremium" = ${input.premium}, "quotedCarrier" = ${input.carrier},
           "quotedAt" = COALESCE("quotedAt", NOW()),
           "bandHitAtQuote" = ${hit}, "bandQuoteMeasuredAt" = ${hit == null ? null : new Date().toISOString()}
     WHERE "id" = ${input.leadId}`;

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${input.leadId}, 'note',
            ${`Quoted ${input.premium} with ${input.carrier}`
              + (hit == null ? ' (no band to compare)' : hit ? ' — inside the published band' : ' — OUTSIDE the published band')},
            ${input.by ?? 'crm'}, NOW())`;

  return { bandHitAtQuote: hit, varianceVsMidpointPct: variance };
}

/**
 * Record a loss (Sec. 10.6).
 *
 * "A lost quote with the competitor's carrier and premium on the record is a live lead at
 * the next renewal. Without it, it is gone." So the re-engagement date is set here rather
 * than left to a later tidy-up — the whole value of the record is that it comes back.
 */
export async function recordLoss(input: {
  leadId: string;
  reason: LossReason;
  competingCarrier?: string | null;
  competingPremium?: number | null;
  ourQuotedPremium?: number | null;
  notes?: string | null;
  by?: string | null;
}): Promise<{ reEngageAt: string | null; premiumGap: number | null; premiumGapPct: number | null }> {
  const spec = LOSS_REASONS.find((r) => r.key === input.reason);
  if (!spec) throw new Error(`Unknown loss reason: ${input.reason}`);

  const [lead] = await sql`
    SELECT "effectiveDate"::text AS "effectiveDate", "quotedPremium"
      FROM "Lead" WHERE "id" = ${input.leadId}` as Row[];
  if (!lead) throw new Error('Lead not found');

  const ours = input.ourQuotedPremium ?? num(lead.quotedPremium);
  const theirs = input.competingPremium ?? null;
  const gap = ours != null && theirs != null ? Math.round((ours - theirs) * 100) / 100 : null;
  const gapPct = gap != null && theirs ? Math.round((gap / theirs) * 10000) / 100 : null;

  /**
   * Sixty days before the NEXT renewal, which is a year after this one. Using this year's
   * effective date would schedule a callback in the past for every lead already past its
   * renewal, and the reminder would fire immediately or never.
   */
  const reEngageAt: string | null = spec.reEngage && lead.effectiveDate
    ? renewalMinusDays(String(lead.effectiveDate), RE_ENGAGE_DAYS_BEFORE_RENEWAL)
    : null;

  await sql`
    UPDATE "Lead"
       SET "lostAt" = COALESCE("lostAt", NOW()),
           "lostReason" = ${input.reason},
           "lostNotes" = ${input.notes ?? null},
           "competitorCarrier" = ${input.competingCarrier ?? null},
           "competitorPremium" = ${theirs},
           "quotedPremium" = COALESCE("quotedPremium", ${ours}),
           "revisitFlag" = ${!!reEngageAt},
           "revisitDate" = ${reEngageAt},
           "revisitNote" = ${reEngageAt ? `Lost: ${spec.label} — revisit before renewal` : null}
     WHERE "id" = ${input.leadId}`;

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${input.leadId}, 'note',
            ${`Lost — ${spec.label}`
              + (input.competingCarrier ? ` to ${input.competingCarrier}` : '')
              + (gap != null ? ` · we were ${gap >= 0 ? 'higher' : 'lower'} by $${Math.abs(gap)}` : '')
              + (reEngageAt ? ` · revisit ${reEngageAt}` : '')},
            ${input.by ?? 'crm'}, NOW())`;

  return { reEngageAt, premiumGap: gap, premiumGapPct: gapPct };
}

// ─── Reporting ────────────────────────────────────────────────────────────────

export type BandAccuracyCut = {
  cut: string;
  quoted: number;
  insideAtQuote: number;
  accuracyAtQuote: number | null;
  bound: number;
  insideAtBind: number;
  accuracyAtBind: number | null;
  avgVarianceVsMidpointPct: number | null;
};

/**
 * Band accuracy, cut the way Sec. 10.9 asks: "by carrier, property type, municipality and
 * cohort".
 *
 * Quote-time and bind-time accuracy are reported side by side and never combined. A gap
 * between them IS the finding — a band that holds at bind but misses at quote means the
 * misses are walking away rather than binding, which is the failure mode Sec. 10.9 names.
 */
export async function bandAccuracy(
  by: 'carrier' | 'propertyType' | 'municipality' | 'cohort' = 'carrier',
): Promise<BandAccuracyCut[]> {
  const rows = await sql`
    SELECT "bandCarrier", "propertyType", "addressCity", "cohort",
           "quotedPremium", "quotedCarrier", "bandHitAtQuote",
           "boundPremium", "bandHit", "bandVariancePct",
           COALESCE("publishedBandLow", "indicativeBandLow")  AS low,
           COALESCE("publishedBandHigh", "indicativeBandHigh") AS high
      FROM "Lead"
     WHERE "quotedAt" IS NOT NULL OR "bandMeasuredAt" IS NOT NULL` as Row[];

  const key = (r: Row) => String(
    by === 'carrier' ? (r.bandCarrier ?? r.quotedCarrier ?? '(no carrier recorded)')
      : by === 'propertyType' ? (r.propertyType ?? '(unknown)')
        : by === 'municipality' ? (r.addressCity ?? '(unknown)')
          : (r.cohort ?? '(untagged)'),
  );

  const acc = new Map<string, { q: number; qi: number; b: number; bi: number; v: number[] }>();
  for (const r of rows) {
    const k = key(r);
    const a = acc.get(k) ?? { q: 0, qi: 0, b: 0, bi: 0, v: [] };
    const low = num(r.low), high = num(r.high);
    const quoted = num(r.quotedPremium);
    if (quoted != null) {
      a.q++;
      if (r.bandHitAtQuote === true) a.qi++;
      if (low != null && high != null && high > 0) {
        const mid = (low + high) / 2;
        a.v.push(((quoted - mid) / mid) * 100);
      }
    }
    if (num(r.boundPremium) != null) { a.b++; if (r.bandHit === true) a.bi++; }
    acc.set(k, a);
  }

  return [...acc.entries()]
    .map(([cut, a]) => ({
      cut,
      quoted: a.q,
      insideAtQuote: a.qi,
      accuracyAtQuote: a.q ? Math.round((a.qi / a.q) * 1000) / 10 : null,
      bound: a.b,
      insideAtBind: a.bi,
      accuracyAtBind: a.b ? Math.round((a.bi / a.b) * 1000) / 10 : null,
      avgVarianceVsMidpointPct: a.v.length
        ? Math.round((a.v.reduce((s, x) => s + x, 0) / a.v.length) * 100) / 100
        : null,
    }))
    .sort((x, y) => (y.quoted + y.bound) - (x.quoted + x.bound));
}

export type LossRow = {
  carrier: string;
  losses: number;
  withPremium: number;
  avgGap: number | null;
  avgGapPct: number | null;
  byReason: Record<string, number>;
  municipalities: string[];
};

/**
 * Who beats us, by how much, and where (Sec. 10.6).
 *
 * "Aggregated, this tells us which carriers beat us, by how much, and in which
 * municipalities — a rating and appetite input, not just a sales note."
 *
 * Losses with no competitor premium are counted but excluded from the average, and the
 * count of each is reported. An average over the third of losses that happened to carry a
 * figure, presented as the gap, is how a rating decision gets made on a number that
 * describes a different population.
 */
export async function lossAnalysis(): Promise<{ rows: LossRow[]; totalLosses: number; missingCompetitor: number }> {
  const rows = await sql`
    SELECT "competitorCarrier", "competitorPremium", "quotedPremium",
           "lostReason", "addressCity"
      FROM "Lead" WHERE "lostAt" IS NOT NULL OR "lostReason" IS NOT NULL` as Row[];

  const acc = new Map<string, { losses: number; gaps: number[]; pcts: number[]; reasons: Record<string, number>; towns: Set<string> }>();
  let missingCompetitor = 0;

  for (const r of rows) {
    const carrier = String(r.competitorCarrier ?? '(not recorded)');
    if (!r.competitorCarrier) missingCompetitor++;
    const a = acc.get(carrier) ?? { losses: 0, gaps: [], pcts: [], reasons: {}, towns: new Set<string>() };
    a.losses++;
    const reason = String(r.lostReason ?? 'unspecified');
    a.reasons[reason] = (a.reasons[reason] ?? 0) + 1;
    if (r.addressCity) a.towns.add(String(r.addressCity));
    const ours = num(r.quotedPremium), theirs = num(r.competitorPremium);
    if (ours != null && theirs != null && theirs > 0) {
      a.gaps.push(ours - theirs);
      a.pcts.push(((ours - theirs) / theirs) * 100);
    }
    acc.set(carrier, a);
  }

  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

  return {
    totalLosses: rows.length,
    missingCompetitor,
    rows: [...acc.entries()]
      .map(([carrier, a]) => ({
        carrier,
        losses: a.losses,
        withPremium: a.gaps.length,
        avgGap: avg(a.gaps),
        avgGapPct: avg(a.pcts),
        byReason: a.reasons,
        municipalities: [...a.towns].sort(),
      }))
      .sort((x, y) => y.losses - x.losses),
  };
}

export type QuoteState = {
  band: { low: number; high: number; mid: number; carrier: string | null; ratedAt: string | null; ratedBy: string | null } | null;
  /** The band the homeowner actually read, when it differs from the current one. */
  published: { low: number; high: number } | null;
  quote: { premium: number; carrier: string | null; at: string | null } | null;
  /** Inside the PUBLISHED band, measured at quote. Null when there was no band to compare. */
  bandHitAtQuote: boolean | null;
  varianceVsMidpointPct: number | null;
  bound: { premium: number; hit: boolean | null; variancePct: number | null } | null;
  loss: {
    at: string | null; reason: string | null; notes: string | null;
    competingCarrier: string | null; competingPremium: number | null;
    premiumGap: number | null; premiumGapPct: number | null;
  } | null;
  reEngageAt: string | null;
};

/**
 * Everything the producer panel shows, derived on read.
 *
 * The gap, the midpoint and the variance are all computed here rather than stored, so the
 * screen can never show a figure that disagrees with the premiums it came from — which is
 * what a cached derived column does the first time somebody corrects a number.
 */
export async function quoteState(leadId: string): Promise<QuoteState> {
  const [l] = await sql`
    SELECT "indicativeBandLow","indicativeBandHigh","bandCarrier",
           "bandRatedAt"::text AS "bandRatedAt","bandRatedBy",
           "publishedBandLow","publishedBandHigh",
           "quotedPremium","quotedCarrier","quotedAt"::text AS "quotedAt",
           "bandHitAtQuote","boundPremium","bandHit","bandVariancePct",
           "lostAt"::text AS "lostAt","lostReason","lostNotes",
           "competitorCarrier","competitorPremium",
           "revisitDate"::text AS "revisitDate"
      FROM "Lead" WHERE "id" = ${leadId} OR "propertyId" = ${leadId} LIMIT 1` as Row[];
  if (!l) throw new Error('Lead not found');

  const bl = num(l.indicativeBandLow), bh = num(l.indicativeBandHigh);
  const pl = num(l.publishedBandLow), ph = num(l.publishedBandHigh);
  const quoted = num(l.quotedPremium);

  // Against the band the homeowner READ where one exists, falling back to the current
  // one. Showing the variance against a band that was re-rated after the email would
  // flatter or damn us for a number nobody ever saw.
  const cmpLow = pl ?? bl, cmpHigh = ph ?? bh;
  const variance = quoted != null && cmpLow != null && cmpHigh != null
    ? Math.round(((quoted - (cmpLow + cmpHigh) / 2) / ((cmpLow + cmpHigh) / 2)) * 10000) / 100
    : null;

  const ours = quoted, theirs = num(l.competitorPremium);
  const gap = ours != null && theirs != null ? Math.round((ours - theirs) * 100) / 100 : null;

  return {
    band: bl != null && bh != null
      ? { low: bl, high: bh, mid: Math.round((bl + bh) / 2), carrier: (l.bandCarrier as string) ?? null,
          ratedAt: (l.bandRatedAt as string) ?? null, ratedBy: (l.bandRatedBy as string) ?? null }
      : null,
    published: pl != null && ph != null && (pl !== bl || ph !== bh) ? { low: pl, high: ph } : null,
    quote: quoted != null
      ? { premium: quoted, carrier: (l.quotedCarrier as string) ?? null, at: (l.quotedAt as string) ?? null }
      : null,
    bandHitAtQuote: (l.bandHitAtQuote as boolean) ?? null,
    varianceVsMidpointPct: variance,
    bound: num(l.boundPremium) != null
      ? { premium: num(l.boundPremium)!, hit: (l.bandHit as boolean) ?? null, variancePct: num(l.bandVariancePct) }
      : null,
    loss: l.lostAt || l.lostReason
      ? {
          at: (l.lostAt as string) ?? null, reason: (l.lostReason as string) ?? null,
          notes: (l.lostNotes as string) ?? null,
          competingCarrier: (l.competitorCarrier as string) ?? null, competingPremium: theirs,
          premiumGap: gap,
          premiumGapPct: gap != null && theirs ? Math.round((gap / theirs) * 10000) / 100 : null,
        }
      : null,
    // Date only. revisitDate is a timestamp column, so ::text yields "2027-09-21 00:00:00"
    // and the panel would print the midnight — a time nobody set and nothing means.
    reEngageAt: l.revisitDate ? String(l.revisitDate).slice(0, 10) : null,
  };
}
