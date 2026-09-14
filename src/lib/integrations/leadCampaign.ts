/**
 * Lead campaign platform — the one place the CRM talks to the outbound email vendor.
 *
 * Every outbound call goes through here. The vendor's brand name appears nowhere in
 * an exported name or in any thrown message, and the key is read from a generic env
 * var, so swapping vendors is a change to this file rather than a find-replace across
 * routes and UI copy.
 *
 * ── Verified against the live API, Sep-2026 ────────────────────────────────────
 * Auth is `Authorization: Bearer <key>`; a bogus key returns 401, so the header is
 * genuinely what authenticates. Confirmed empirically rather than from the docs,
 * along with three shapes that are not what you would guess:
 *
 *   • Listing leads is POST /leads/list, not GET /leads (which 404s).
 *   • There is NO bulk lead endpoint — /leads/bulk and /leads/list/bulk both 404.
 *     POST /leads creates exactly one. So addLeadsToCampaign loops and reports a
 *     result per lead; a partial failure is normal and must not fail the batch.
 *   • Campaign analytics for every campaign comes back from ONE call, so the
 *     overview never needs N+1 per-campaign requests.
 *
 * No retries and no backoff: one fetch per logical call, errors thrown plainly for
 * the route layer to map to a 502. Pagination loops carry a hard page ceiling as a
 * defence against an infinite loop on a vendor bug, not as rate limiting.
 */

const API_BASE = 'https://api.instantly.ai/api/v2';

/** Defensive ceiling on any pagination loop — not rate limiting. */
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

function apiKey(): string {
  const key = process.env.LEADS_CAMPAIGN_API_KEY;
  if (!key?.trim()) throw new Error('LEADS_CAMPAIGN_API_KEY not configured');
  return key.trim();
}

/** True when a key is present — lets a route answer "are we connected?" without a call. */
export function isConfigured(): boolean {
  return Boolean(process.env.LEADS_CAMPAIGN_API_KEY?.trim());
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    // Deliberately says "Campaign tool", not the vendor's name: these messages reach
    // producers in toasts.
    throw new Error(
      `Campaign tool ${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${bodyText.slice(0, 300)}`,
    );
  }
  return res;
}

const getJson = async <T>(path: string): Promise<T> => (await apiFetch(path)).json() as Promise<T>;
const postJson = async <T>(path: string, body: unknown): Promise<T> =>
  (await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<T>;

/** Walk a cursor-paginated list endpoint to the page ceiling. */
async function paginate<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}limit=${PAGE_SIZE}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`;
    const json = await getJson<{ items?: T[]; next_starting_after?: string }>(url);
    out.push(...(json.items ?? []));
    if (!json.next_starting_after) break;
    cursor = json.next_starting_after;
  }
  return out;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Vendor campaign status codes. 1 = active is the only one we act on. */
export const CAMPAIGN_STATUS: Record<number, string> = {
  0: 'Draft',
  1: 'Active',
  2: 'Paused',
  3: 'Completed',
  4: 'Running subsequences',
};

export type Campaign = {
  id: string;
  name: string;
  status: number;
  daily_limit?: number;
  stop_on_reply?: boolean;
  insert_unsubscribe_header?: boolean;
  link_tracking?: boolean;
  open_tracking?: boolean;
  email_list?: string[];
  campaign_schedule?: {
    schedules?: Array<{
      name?: string;
      timing?: { from?: string; to?: string };
      days?: Record<string, boolean>;
      timezone?: string;
    }>;
  };
  sequences?: Array<{ steps?: Array<{ type?: string; delay?: number; variants?: Array<{ subject?: string; body?: string }> }> }>;
  timestamp_created?: string;
};

export type CampaignAnalytics = {
  campaign_id: string;
  campaign_name: string;
  campaign_status: number;
  leads_count: number;
  contacted_count: number;
  emails_sent_count: number;
  open_count: number;
  reply_count: number;
  link_click_count: number;
  bounced_count: number;
  unsubscribed_count: number;
  completed_count: number;
};

export type EmailAccount = {
  email: string;
  first_name?: string;
  last_name?: string;
  warmup_status?: number;
  stat_warmup_score?: number;
  daily_limit?: number;
  tracking_domain_name?: string | null;
  tracking_domain_status?: string | null;
  status?: number;
  /** True while the platform is still provisioning it — not a usable sender yet. */
  setup_pending?: boolean;
  is_managed_account?: boolean;
};

/** One lead as the vendor stores it. `payload` holds whatever custom fields we sent. */
export type VendorLead = {
  id: string;
  email: string;
  /** Names live at the TOP level. `payload` carries them too, but camelCased —
   *  reading payload.first_name (snake, inside payload) finds neither. */
  first_name?: string;
  last_name?: string;
  campaign?: string;
  status?: number;
  email_open_count?: number;
  email_reply_count?: number;
  email_click_count?: number;
  timestamp_last_contact?: string | null;
  payload?: Record<string, unknown>;
};

export type LeadInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  /** Merge fields available to the sequence copy as {{key}}. */
  custom_variables?: Record<string, string | number | null>;
};

// ─── Campaigns ────────────────────────────────────────────────────────────────

/**
 * Light picker list — id/name/status only.
 * Doubles as the connection check, so keep it cheap: no analytics fetch here.
 */
export async function listCampaigns(): Promise<Array<Pick<Campaign, 'id' | 'name' | 'status'>>> {
  const items = await paginate<Campaign>('/campaigns');
  return items.map((c) => ({ id: c.id, name: c.name, status: c.status }));
}

export async function getCampaign(id: string): Promise<Campaign> {
  return getJson<Campaign>(`/campaigns/${encodeURIComponent(id)}`);
}

/**
 * Every campaign's counters in ONE call — merge into the list client-side by id.
 * Doing this per campaign would be N+1 for a dashboard that always shows all of them.
 */
export async function getAllCampaignAnalytics(): Promise<CampaignAnalytics[]> {
  const json = await getJson<CampaignAnalytics[]>('/campaigns/analytics');
  return Array.isArray(json) ? json : [];
}

/**
 * Whole-campaign counters. Distinguishes total from unique deliberately: a single
 * recipient opening five times is five opens but one person, and only the unique
 * figure divided by sends is a rate anyone should quote.
 */
export type CampaignOverview = {
  emails_sent_count?: number;
  contacted_count?: number;
  open_count?: number;
  open_count_unique?: number;
  link_click_count?: number;
  link_click_count_unique?: number;
  reply_count?: number;
  reply_count_unique?: number;
  bounced_count?: number;
  unsubscribed_count?: number;
  completed_count?: number;
  total_opportunities?: number;
};

export type CampaignDailyPoint = {
  date: string;
  sent: number;
  contacted: number;
  new_leads_contacted: number;
  opened: number;
  unique_opened: number;
  replies: number;
  unique_replies: number;
  clicks: number;
  unique_clicks: number;
  opportunities: number;
  unique_opportunities: number;
};

export type CampaignStepStat = {
  step: string;
  variant: string;
  sent: number;
  opened: number;
  unique_opened: number;
  replies: number;
  unique_replies: number;
  clicks: number;
  unique_clicks: number;
};

/**
 * ⚠ The three analytics endpoints do NOT share a filter parameter name.
 *
 *   /analytics/daily    and  /analytics/steps  →  campaign_id=<id>
 *   /analytics/overview                        →  ids=<id>
 *
 * Verified by differential against the live API, Sep-2026, and the mismatch is a trap
 * rather than a curiosity: an unrecognised parameter name is IGNORED, not rejected, so
 * `overview?campaign_id=…` silently returns whole-workspace totals. Those totals then
 * render on one campaign's page as if they were its own — a campaign that has never
 * sent anything reporting the workspace's send count. Confirmed by passing a bogus
 * campaign id: `?campaign_id=00000000-…` still returned the full workspace figures,
 * whereas `?ids=00000000-…` returned zeroes.
 *
 * `ids` is genuinely parsed rather than coincidentally zeroing things out: a malformed
 * value (`?ids=garbage`) errors instead of falling back to unfiltered.
 *
 * Not yet proven: that `ids` returns the right NON-ZERO figures for a campaign that has
 * sent. No campaign in the workspace has sends yet, so only the zero case is covered.
 * Re-check this against a live sending campaign before quoting these numbers to anyone.
 *
 * `start_date`/`end_date` are inclusive ISO dates, honoured on daily.
 */
function analyticsQuery(campaignId: string, range?: { start?: string; end?: string }): string {
  const q = new URLSearchParams({ campaign_id: campaignId });
  if (range?.start) q.set('start_date', range.start);
  if (range?.end) q.set('end_date', range.end);
  return q.toString();
}

export async function getCampaignOverview(
  campaignId: string, range?: { start?: string; end?: string },
): Promise<CampaignOverview> {
  // `ids`, NOT `campaign_id` — see the note above before changing this.
  const q = new URLSearchParams({ ids: campaignId });
  if (range?.start) q.set('start_date', range.start);
  if (range?.end) q.set('end_date', range.end);
  return getJson<CampaignOverview>(`/campaigns/analytics/overview?${q.toString()}`);
}

export async function getCampaignDaily(
  campaignId: string, range?: { start?: string; end?: string },
): Promise<CampaignDailyPoint[]> {
  const json = await getJson<CampaignDailyPoint[]>(`/campaigns/analytics/daily?${analyticsQuery(campaignId, range)}`);
  return Array.isArray(json) ? json : [];
}

export async function getCampaignStepStats(campaignId: string): Promise<CampaignStepStat[]> {
  const json = await getJson<CampaignStepStat[]>(`/campaigns/analytics/steps?${analyticsQuery(campaignId)}`);
  return Array.isArray(json) ? json : [];
}

export async function pauseCampaign(id: string): Promise<void> {
  await apiFetch(`/campaigns/${encodeURIComponent(id)}/pause`, { method: 'POST' });
}

export async function activateCampaign(id: string): Promise<void> {
  await apiFetch(`/campaigns/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}

// ─── Sending mailboxes ────────────────────────────────────────────────────────

export async function listEmailAccounts(): Promise<EmailAccount[]> {
  return paginate<EmailAccount>('/accounts');
}

// ─── Leads ────────────────────────────────────────────────────────────────────

/**
 * Leads already in a campaign — used for dedup and for reading back outcomes.
 *
 * The filter key is `campaign`, NOT `campaign_id`. Verified live: passing
 * `campaign_id` is silently ignored and the endpoint returns every lead in the
 * workspace — so a campaign's lead list would show other campaigns' recipients with
 * no error to hint at it. The client-side filter below is a second line of defence,
 * because the failure mode of getting this wrong is showing one client's leads under
 * another campaign rather than an obvious crash.
 */
export async function listLeadsInCampaign(campaignId: string): Promise<VendorLead[]> {
  const out: VendorLead[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await postJson<{ items?: VendorLead[]; next_starting_after?: string }>(
      '/leads/list',
      { campaign: campaignId, limit: PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) },
    );
    out.push(...(json.items ?? []));
    if (!json.next_starting_after) break;
    cursor = json.next_starting_after;
  }
  return out.filter((l) => !l.campaign || l.campaign === campaignId);
}

/**
 * Is this address already somewhere in the workspace?
 * Checked before a push so a homeowner cannot land in two campaigns at once — the
 * vendor's own per-campaign duplicate flag does not cover that.
 */
export async function findLeadsByEmail(email: string): Promise<VendorLead[]> {
  const json = await postJson<{ items?: VendorLead[] }>('/leads/list', {
    search: email.trim().toLowerCase(),
    limit: 10,
  });
  const wanted = email.trim().toLowerCase();
  // The vendor's `search` is not guaranteed to be an exact match, so narrow locally.
  return (json.items ?? []).filter((l) => String(l.email ?? '').toLowerCase() === wanted);
}

export type AddLeadResult = {
  email: string;
  ok: boolean;
  /** Vendor's own lead id — what the webhook later matches on. */
  leadId?: string;
  error?: string;
};

/**
 * Add leads to a campaign, one vendor call each.
 *
 * The vendor has no bulk endpoint (verified: /leads/bulk 404s), so this loops. A
 * failure on one lead is reported and the rest continue — a batch that aborts
 * halfway leaves the caller unable to tell which leads actually landed, which is
 * precisely the state we cannot be in when the next step writes send-log rows.
 */
export async function addLeadsToCampaign(
  campaignId: string,
  leads: LeadInput[],
  opts?: { gapMs?: number },
): Promise<AddLeadResult[]> {
  const gap = opts?.gapMs ?? 150;
  const results: AddLeadResult[] = [];

  for (const lead of leads) {
    const email = String(lead.email ?? '').trim().toLowerCase();
    if (!email) {
      results.push({ email: '', ok: false, error: 'No email address' });
      continue;
    }
    try {
      const created = await postJson<VendorLead>('/leads', {
        campaign: campaignId,
        email,
        ...(lead.first_name ? { first_name: lead.first_name } : {}),
        ...(lead.last_name ? { last_name: lead.last_name } : {}),
        ...(lead.company_name ? { company_name: lead.company_name } : {}),
        ...(lead.custom_variables ? { custom_variables: lead.custom_variables } : {}),
      });
      results.push({ email, ok: true, leadId: created?.id });
    } catch (err) {
      results.push({ email, ok: false, error: (err as Error)?.message ?? 'Create failed' });
    }
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
  return results;
}

// ─── Replies / message feed ───────────────────────────────────────────────────

export type VendorEmail = {
  id: string;
  /** Distinct from `id` — the two are NOT interchangeable when replying to a thread. */
  message_id?: string;
  thread_id?: string;
  campaign_id?: string;
  subject?: string;
  body?: { text?: string; html?: string } | string;
  from_address_email?: string;
  to_address_email_list?: string;
  timestamp_email?: string;
  is_unread?: boolean;
  ue_type?: number;
  lead_id?: string;
};

/** Recent messages — the raw feed behind replies. */
export async function listEmails(opts?: { campaignId?: string; limit?: number }): Promise<VendorEmail[]> {
  const params = new URLSearchParams({ limit: String(opts?.limit ?? PAGE_SIZE) });
  if (opts?.campaignId) params.set('campaign_id', opts.campaignId);
  const json = await getJson<{ items?: VendorEmail[] }>(`/emails?${params.toString()}`);
  return json.items ?? [];
}

// ─── Campaign lifecycle (verified: all of these routes exist) ─────────────────

export type CreateCampaignInput = {
  name: string;
  timezone: string;
  /** 24h "HH:MM" in the campaign's own timezone. */
  from?: string;
  to?: string;
  days?: Record<string, boolean>;
  /** Mailboxes that send it. Empty means the platform's default selection. */
  emailList?: string[];
  dailyLimit?: number;
  /** First sequence step. A campaign with no step cannot send anything. */
  subject?: string;
  body?: string;
};

/**
 * Create a campaign in a draft (inactive) state.
 *
 * `campaign_schedule.schedules[]` is required with at least one entry, and its
 * `timezone` must come from the platform's curated list — see campaignTimezones.ts,
 * where the surprising rejections are documented. A campaign is created paused; the
 * sequence goes on separately and activation is an explicit, separate action.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const body: Record<string, unknown> = {
    name: input.name,
    campaign_schedule: {
      schedules: [{
        name: 'Default Schedule',
        timing: { from: input.from ?? '09:00', to: input.to ?? '17:00' },
        days: input.days ?? { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false },
        timezone: input.timezone,
      }],
    },
  };
  if (input.emailList?.length) body.email_list = input.emailList;
  if (input.dailyLimit != null) body.daily_limit = input.dailyLimit;
  // Frank Sep-2026 (T1.6): one-click unsubscribe on every send, without exception.
  // Set at create time so a campaign cannot exist without it.
  body.insert_unsubscribe_header = true;
  // Stop the sequence the moment somebody replies — the whole point of tracking them.
  body.stop_on_reply = true;

  if (input.subject || input.body) {
    body.sequences = [{
      steps: [{
        type: 'email',
        delay: 0,
        variants: [{ subject: input.subject ?? '', body: input.body ?? '' }],
      }],
    }];
  }
  return postJson<Campaign>('/campaigns', body);
}

/**
 * Generic PATCH — backs rename, schedule, options, mailbox assignment and sequence
 * edits, which are all the same call underneath. Callers pass only what changes.
 */
export async function patchCampaign(id: string, patch: Record<string, unknown>): Promise<Campaign> {
  const res = await apiFetch(`/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.json() as Promise<Campaign>;
}

export async function duplicateCampaign(id: string): Promise<Campaign> {
  const res = await apiFetch(`/campaigns/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
  return res.json() as Promise<Campaign>;
}

export async function deleteCampaign(id: string): Promise<void> {
  await apiFetch(`/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Delete one lead from the platform entirely. */
export async function deleteLead(leadId: string): Promise<void> {
  await apiFetch(`/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
}

/**
 * How many leads each campaign actually holds.
 *
 * Needed because /campaigns/analytics only contains campaigns that have SEND
 * activity — a draft campaign is absent from the response entirely, not merely
 * reported as zero. Defaulting a missing row to zero made a campaign holding 300
 * leads read "0 leads", which looks exactly like a failed import.
 *
 * Counted with ONE pass over the workspace's leads, grouped by campaign locally,
 * rather than a request per campaign: the overview always renders every campaign,
 * so per-campaign counting would be N+1 by construction.
 *
 * `truncated` is true when the page ceiling was hit, so the caller can say "1000+"
 * instead of quietly reporting a number it knows is short.
 */
export async function getLeadCountsByCampaign(
  opts?: { maxPages?: number },
): Promise<{ counts: Map<string, number>; truncated: boolean }> {
  const maxPages = opts?.maxPages ?? 50; // 50 × 100 = 5,000 leads
  const counts = new Map<string, number>();
  let cursor: string | undefined;
  let truncated = true;

  for (let page = 0; page < maxPages; page++) {
    const json = await postJson<{ items?: VendorLead[]; next_starting_after?: string }>(
      '/leads/list',
      { limit: PAGE_SIZE, ...(cursor ? { starting_after: cursor } : {}) },
    );
    for (const lead of json.items ?? []) {
      const id = lead.campaign;
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (!json.next_starting_after) { truncated = false; break; }
    cursor = json.next_starting_after;
  }
  return { counts, truncated };
}
