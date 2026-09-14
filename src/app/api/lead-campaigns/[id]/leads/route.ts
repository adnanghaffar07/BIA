import { NextRequest, NextResponse } from 'next/server';
import {
  listLeadsInCampaign, addLeadsToCampaign, findLeadsByEmail, LeadInput,
} from '@/lib/integrations/leadCampaign';
import { requireCampaignAccess, vendorError } from '@/lib/integrations/campaignAccess';

/**
 * Leads inside one campaign.
 *
 *   GET  → who is in it and what has happened to them
 *   POST → add leads (one manual entry, or many from a CRM push)
 *
 * Both entry points go through the SAME add path and the same cap, so a rule added
 * here cannot be bypassed by using the other form.
 */

/**
 * Ceiling per request, deliberately below what the platform itself would accept.
 * A filtered CRM push that silently truncates is worse than one that refuses: the
 * operator thinks the whole cohort went out and never learns which leads were
 * dropped. Refusing forces them to narrow the filter instead.
 */
// Explicit, like the push route: the client sends eight leads per request (~5.8s at
// the measured 720-830ms each), so this ceiling is never the binding constraint.
export const maxDuration = 10;

const MAX_LEADS_PER_REQUEST = 300;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;
  try {
    const { id } = await params;
    const leads = await listLeadsInCampaign(id);
    const data = leads.map((l) => ({
      id: l.id,
      email: l.email,
      status: l.status ?? null,
      opens: l.email_open_count ?? 0,
      replies: l.email_reply_count ?? 0,
      clicks: l.email_click_count ?? 0,
      lastContact: l.timestamp_last_contact ?? null,
      // Top level first; payload is the camelCase fallback.
      firstName: l.first_name ?? (l.payload as any)?.firstName ?? null,
      lastName: l.last_name ?? (l.payload as any)?.lastName ?? null,
      // Set by the CRM push so a lead can be traced back to the record it came from.
      propertyId: (l.payload as any)?.crm_property_id ?? null,
    }));
    return NextResponse.json({
      success: true,
      count: data.length,
      replied: data.filter((d) => d.replies > 0).length,
      opened: data.filter((d) => d.opens > 0).length,
      data,
    });
  } catch (err) {
    return vendorError(err, 'Could not load the campaign leads');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Accept either a single lead or a list — one shared path from here down.
    const incoming: any[] = Array.isArray(body?.leads)
      ? body.leads
      : body?.email ? [body] : [];

    if (!incoming.length) {
      return NextResponse.json({ error: 'No leads to add.' }, { status: 400 });
    }
    if (incoming.length > MAX_LEADS_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `That is ${incoming.length} leads; this adds at most ${MAX_LEADS_PER_REQUEST} at a time. `
            + 'Narrow the filter and run it again so nothing is dropped without you seeing it.',
        },
        { status: 400 },
      );
    }

    // Normalise + drop anything without a usable address, reporting the count rather
    // than quietly shrinking the batch.
    const skipped: Array<{ email: string; reason: string }> = [];
    const seen = new Set<string>();
    const leads: LeadInput[] = [];
    for (const raw of incoming) {
      const email = String(raw?.email ?? '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        skipped.push({ email: String(raw?.email ?? ''), reason: 'not a valid email address' });
        continue;
      }
      if (seen.has(email)) { skipped.push({ email, reason: 'duplicate within this request' }); continue; }
      seen.add(email);
      leads.push({
        email,
        first_name: raw?.firstName ? String(raw.firstName) : undefined,
        last_name: raw?.lastName ? String(raw.lastName) : undefined,
        company_name: raw?.companyName ? String(raw.companyName) : undefined,
        custom_variables: raw?.customVariables ?? undefined,
      });
    }

    // Workspace-wide dedup. The platform's own per-campaign duplicate flag does not
    // stop the same homeowner sitting in two campaigns at once, which is how somebody
    // receives two different cold sequences from the same agency in one week.
    if (body?.checkDuplicates !== false) {
      const deduped: LeadInput[] = [];
      for (const lead of leads) {
        const existing = await findLeadsByEmail(lead.email);
        if (existing.length) {
          skipped.push({ email: lead.email, reason: 'already in a campaign on the platform' });
        } else {
          deduped.push(lead);
        }
      }
      leads.length = 0;
      leads.push(...deduped);
    }

    if (!leads.length) {
      return NextResponse.json({ success: true, added: 0, failed: 0, skipped, results: [] });
    }

    const results = await addLeadsToCampaign(id, leads);
    return NextResponse.json({
      success: true,
      added: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      skipped,
      results,
    });
  } catch (err) {
    return vendorError(err, 'Could not add leads to the campaign');
  }
}
