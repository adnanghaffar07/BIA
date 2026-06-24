import { NextRequest, NextResponse } from 'next/server';
import { ERROR_MESSAGES, API_CONFIG } from '@/lib/constants';
import { upsertLeads, getLeadsFromDb, getLeadCounts } from '@/services/storage.service';
import { enrichLeadBatch } from '@/services/enrichment.service';
import sql from '@/lib/neon';

/** Check whether the one-time REAPI seed has already been done */
async function isApiSeeded(): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT "value" FROM "AppConfig" WHERE "key" = 'api_seeded'
    ` as any[];
    return rows.length > 0 && rows[0].value === 'true';
  } catch {
    // AppConfig table may not exist yet — treat as not seeded
    return false;
  }
}

/** Returns YYYY-MM-DD string offset by `days` from today (negative = past) */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * GET /api/leads
 * Fetch NJ properties from Real Estate API using mortgage date filters,
 * store them in DB, and return enriched results.
 *
 * Query params:
 *   size    — number of records (default 100)
 *   engine  — 1 (New Purchase), 2 (Renewal), omit for all
 *   grade   — A | B | C | D (filter DB results)
 *   status  — new | contacted | qualified | quote_sent | bound | lost
 *   source  — 'db' to skip API and return stored leads only
 *   active  — 'true' excludes bound/lost (active working queue)
 *   closed  — 'true' returns only bound/lost leads
 *   orderBy — 'xdate' sorts by renewalTargetDate ASC (producer priority queue)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const size    = parseInt(searchParams.get('size') || '100', 10);
    const engine  = searchParams.get('engine') ? parseInt(searchParams.get('engine')!) : undefined;
    const grade   = searchParams.get('grade') || undefined;
    const status  = searchParams.get('status') || undefined;
    const source  = searchParams.get('source') || 'api';
    const active  = searchParams.get('active') === 'true';
    const closed  = searchParams.get('closed') === 'true';
    const orderBy = (searchParams.get('orderBy') === 'xdate' ? 'xdate' : 'updated') as 'xdate' | 'updated';
    const effectiveDate = searchParams.get('effectiveDate') || undefined; // daily triage filter
    const effectiveTo   = searchParams.get('effectiveTo') || undefined;   // optional range end

    const excludeStatuses = active ? ['bound', 'lost'] : undefined;
    const onlyStatuses    = closed ? 'bound' : undefined; // simplified: show bound in closed tab

    // If source=db, return stored leads without calling external API
    if (source === 'db') {
      const leads = await getLeadsFromDb({
        engine, grade,
        status: closed ? undefined : (status || undefined),
        effectiveDate, effectiveTo,
        excludeStatuses,
        orderBy,
        limit: size,
      });
      // client-side filter for closed = bound OR lost
      const result = closed
        ? leads.filter((l) => l.status === 'bound' || l.status === 'lost')
        : leads;
      // DB-wide counts (per engine) so the UI can show totals + offer "load all"
      const counts = await getLeadCounts({ grade, status: closed ? undefined : (status || undefined), effectiveDate, effectiveTo });
      return NextResponse.json({ success: true, data: result, total: result.length, counts, source: 'db' });
    }

    // ── Hard lock: REAPI is only called once, via POST /api/admin/seed ────────
    // After seeding, `api_seeded = true` is written to AppConfig.
    // All subsequent GET requests serve from DB regardless of row count.
    const seeded = await isApiSeeded();
    if (seeded) {
      const leads = await getLeadsFromDb({ engine, grade, status, limit: size });
      console.log(`📦 REAPI lock active — serving ${leads.length} leads from DB`);
      return NextResponse.json({ success: true, data: leads, total: leads.length, source: 'db' });
    }

    // Also check if DB already has rows (demo data or previous partial seed)
    const existing = await getLeadsFromDb({ limit: 1 });
    if (existing.length > 0) {
      const leads = await getLeadsFromDb({ engine, grade, status, limit: size });
      console.log(`📦 DB has ${leads.length} leads — skipping REAPI (use /api/admin/seed to force refresh)`);
      return NextResponse.json({ success: true, data: leads, total: leads.length, source: 'db' });
    }
    console.log('🌱 DB empty and not locked — calling REAPI (one-time fallback)...');

    if (!API_CONFIG.API_KEY) {
      return NextResponse.json(
        { success: false, error: 'API Key not configured' },
        { status: 500 }
      );
    }

    // Build date filters based on pipeline engine
    // Engine 1 — New Purchase: first mortgage recorded within last 90 days
    // Engine 2 — Renewal:      first mortgage recorded 2022-01-01 → 90 days ago
    const dateFilters: Record<string, string> = {};
    if (engine === 1) {
      dateFilters.first_mortgage_recording_date_min = offsetDate(-90);
      dateFilters.first_mortgage_recording_date_max = offsetDate(0);
    } else if (engine === 2) {
      dateFilters.first_mortgage_recording_date_min = '2022-01-01';
      dateFilters.first_mortgage_recording_date_max = offsetDate(-90);
    }
    // No engine param → no date filter, return general NJ properties

    const requestBody = {
      ids_only: false,
      obfuscate: false,
      summary: false,
      size,
      // ── Permanent filters for BIA insurance leads ──────────────────────────
      state: 'NJ',
      zip: ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'],
      flood_zone: false,
      vacant: false,
      pre_foreclosure: false,
      foreclosure: false,
      reo: false,
      // ───────────────────────────────────────────────────────────────────────
      ...dateFilters,
    };

    console.log('📤 Real Estate API Request (NJ):', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_CONFIG.BASE_URL}/PropertySearch`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': API_CONFIG.API_KEY,
        'x-user-id': API_CONFIG.USER_ID,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Real Estate API Error:', response.statusText, errorText);
      throw new Error(`Real Estate API Error: ${response.statusText}`);
    }

    const data = await response.json();

    console.log('📥 Real Estate API Response:', {
      statusCode: data.statusCode,
      resultCount: data.resultCount,
      recordCount: data.recordCount,
    });

    const properties = data.data || [];

    // Ingest into DB (dedup + engine assignment happen inside upsertLeads)
    const ingestResult = await upsertLeads(properties);
    console.log('💾 DB ingest result:', ingestResult);

    // Run carrier check + grading + pricing on all ingested properties
    const enrichResult = await enrichLeadBatch(properties);
    console.log('🔍 Enrichment result:', enrichResult);

    // Return DB records (now with carrier eligibility, grade, and pricing)
    const enrichedLeads = await getLeadsFromDb({ engine, grade, status, limit: size });

    return NextResponse.json({
      success: true,
      data: enrichedLeads.length > 0 ? enrichedLeads : properties,
      total: data.resultCount || properties.length,
      ingest: ingestResult,
      source: 'api',
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.FETCH_LEADS_FAILED,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leads
 * Advanced property search with custom filters — all NJ only.
 */
export async function POST(request: NextRequest) {
  try {
    if (!API_CONFIG.API_KEY) {
      return NextResponse.json(
        { success: false, error: 'API Key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();

    const requestBody = {
      ids_only: body.ids_only || false,
      obfuscate: body.obfuscate || false,
      summary: body.summary || false,
      size: body.size || 100,
      // ── Permanent filters — always enforced ───────────────────────────────
      state: 'NJ',
      flood_zone: false,
      vacant: false,
      pre_foreclosure: false,
      foreclosure: false,
      reo: false,
      // ─────────────────────────────────────────────────────────────────────
      ...body.filters,
    };

    console.log('📤 Real Estate API POST Request:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${API_CONFIG.BASE_URL}/PropertySearch`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': API_CONFIG.API_KEY,
        'x-user-id': API_CONFIG.USER_ID,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Real Estate API Error:', response.statusText, errorText);
      throw new Error(`Real Estate API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const properties = data.data || [];

    const ingestResult = await upsertLeads(properties);
    console.log('💾 DB ingest result:', ingestResult);

    const enrichResult = await enrichLeadBatch(properties);
    console.log('🔍 Enrichment result:', enrichResult);

    return NextResponse.json({
      success: true,
      data: properties,
      total: data.resultCount || properties.length,
      ingest: ingestResult,
      enrich: enrichResult,
      message: 'NJ properties fetched, stored, and enriched successfully',
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.FETCH_LEADS_FAILED,
      },
      { status: 500 }
    );
  }
}
