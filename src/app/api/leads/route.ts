import { NextRequest, NextResponse } from 'next/server';
import { ERROR_MESSAGES, API_CONFIG } from '@/lib/constants';
import { upsertLeads, getLeadsFromDb } from '@/services/storage.service';
import { enrichLeadBatch } from '@/services/enrichment.service';

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
 *   size    — number of records (default 20)
 *   engine  — 1 (New Purchase), 2 (Renewal), omit for all
 *   grade   — A | B | C | D (filter DB results)
 *   status  — new | contacted | qualified | quote_sent | bound | lost
 *   source  — 'db' to skip API and return stored leads only
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const size   = parseInt(searchParams.get('size') || '100', 10);
    const engine = searchParams.get('engine') ? parseInt(searchParams.get('engine')!) : undefined;
    const grade  = searchParams.get('grade') || undefined;
    const status = searchParams.get('status') || undefined;
    const source = searchParams.get('source') || 'api';

    // If source=db, return stored leads without calling external API
    if (source === 'db') {
      const leads = await getLeadsFromDb({ engine, grade, status, limit: size });
      return NextResponse.json({ success: true, data: leads, total: leads.length, source: 'db' });
    }

    // ── DB-first guard: only call REAPI if the database is empty ──────────────
    // This preserves REAPI credits — once 100 records are seeded, every
    // subsequent page load reads from Neon instead of spending a credit.
    const existing = await getLeadsFromDb({ limit: 1 });
    if (existing.length > 0) {
      const leads = await getLeadsFromDb({ engine, grade, status, limit: size });
      console.log(`📦 DB already seeded (${leads.length} leads) — skipping REAPI call`);
      return NextResponse.json({ success: true, data: leads, total: leads.length, source: 'db' });
    }
    console.log('🌱 DB is empty — calling REAPI to seed 100 leads (one-time)...');

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
      state: 'NJ',           // New Jersey only
      flood_zone: false,     // Exclude FEMA flood zone properties
      vacant: false,         // Exclude vacant properties
      pre_foreclosure: false, // Exclude pre-foreclosure
      foreclosure: false,    // Exclude active foreclosures
      reo: false,            // Exclude bank-owned properties
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
