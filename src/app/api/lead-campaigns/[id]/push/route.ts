import { NextRequest, NextResponse } from 'next/server';
import { triagePush, pushChunk, PushFilters } from '@/services/campaignPush.service';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * Push CRM leads into a campaign.
 *
 *   GET  → FREE preview: who would be mailed, and what is excluded and why
 *   POST → push one bounded chunk; call again until `done`
 *
 * The filter keys are the Leads page's own and are handed straight to the same query,
 * so what gets pushed is what the user was looking at.
 */

/**
 * Serverless budget, measured against the live platform rather than estimated.
 *
 *   triage alone          ~1.0s   (runs every chunk: the filter query + existing rows)
 *   per lead             ~1.8s   (dedup call, create call, three DB writes, gap)
 *   chunk of 25          ~20s    past every Vercel limit
 *   chunk of 5            8.5s   too close to the 10s floor once cold start is added
 *   chunk of 3            6.3s   the size actually used
 *
 * Vercel's tightest function limit is 10s and a cold start plus its own hop to the
 * platform eat into that, so three is the largest size with real headroom. The cost
 * is request count: ~100 round trips for a 300-lead push, a few minutes of wall
 * clock. That is an acceptable trade because every chunk commits before returning —
 * a slow push is resumable, a timed-out one leaves nobody able to say what landed.
 */
export const maxDuration = 10;

const DEFAULT_CHUNK = 3;
const MAX_CHUNK = 5;

/** Hard ceiling on one push. Above this, narrow the filter — see the leads route. */
const MAX_PER_PUSH = 300;

function parseFilters(req: NextRequest): PushFilters {
  const q = req.nextUrl.searchParams;
  const str = (k: string) => { const v = q.get(k); return v && v.trim() ? v.trim() : undefined; };
  const engine = str('engine');
  return {
    grade: str('grade'),
    status: str('status'),
    carrier: str('carrier'),
    propertyType: str('propertyType'),
    county: str('county'),
    zip: str('zip'),
    engine: engine ? Number(engine) : undefined,
    effectiveDate: str('effectiveDate'),
    effectiveTo: str('effectiveTo'),
  };
}


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const t = await triagePush(id, parseFilters(request), {});
    return NextResponse.json({
      success: true,
      matching: t.matching,
      eligible: t.eligible.length,
      skipped: t.skipped,
      overCap: t.eligible.length > MAX_PER_PUSH,
      maxPerPush: MAX_PER_PUSH,
      // A glance at who is actually going out, so the cohort can be sanity-checked
      // before anyone commits to mailing it.
      sample: t.eligible.slice(0, 5).map((r) => ({
        email: r.email,
        role: r.personRole,
        address: [r.lead.addressStreet, r.lead.addressCity].filter(Boolean).join(', '),
      })),
    });
  } catch (err) {
    return vendorError(err, 'Could not work out who would be pushed');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const filters = parseFilters(request);
    const opts = {};

    // Re-check the ceiling on every chunk, not just the first: the filter comes in on
    // each request and nothing stops a caller widening it mid-run.
    const t = await triagePush(id, filters, opts);
    if (t.eligible.length > MAX_PER_PUSH) {
      return NextResponse.json(
        {
          error: `${t.eligible.length} leads match; this pushes at most ${MAX_PER_PUSH} at a time. `
            + 'Narrow the filter so nothing is dropped without you seeing it.',
        },
        { status: 400 },
      );
    }

    const raw = Number(request.nextUrl.searchParams.get('chunk') || DEFAULT_CHUNK);
    const chunk = Math.min(Math.max(Number.isFinite(raw) ? raw : DEFAULT_CHUNK, 1), MAX_CHUNK);

    const result = await pushChunk(id, filters, opts, chunk, gate.actor.email);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return vendorError(err, 'Could not push leads to the campaign');
  }
}
