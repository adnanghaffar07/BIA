import { NextResponse } from 'next/server';
import { API_CONFIG } from '@/lib/constants';
import { upsertLeads, getLeadsFromDb } from '@/services/storage.service';
import { enrichLeadBatch } from '@/services/enrichment.service';
import sql, { pool } from '@/lib/neon';

/** Returns YYYY-MM-DD string offset by `days` from today */
function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * POST /api/admin/seed
 *
 * ONE-TIME forced seed from Real Estate API.
 * - Clears existing demo/placeholder leads
 * - Fetches 50 Engine 1 (New Purchase) + 50 Engine 2 (Renewal) leads from REAPI
 * - Saves + enriches all 100 in Neon
 * - Sets `api_seeded = true` in the config table so REAPI is NEVER called again
 *   until you explicitly reset it
 *
 * Protected: SuperAdmin only (enforced by middleware).
 */
export async function POST() {
  try {
    // ── 1. Verify API key ───────────────────────────────────────────────────
    if (!API_CONFIG.API_KEY) {
      return NextResponse.json(
        { success: false, error: 'NEXT_PUBLIC_REAL_ESTATE_API_KEY not configured' },
        { status: 500 }
      );
    }

    // ── 2. Ensure config table exists and check lock ─────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS "AppConfig" (
        "key"   TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    const lock = await sql`SELECT "value" FROM "AppConfig" WHERE "key" = 'api_seeded'` as any[];
    if (lock.length > 0 && lock[0].value === 'true') {
      return NextResponse.json({
        success: false,
        error: 'REAPI has already been seeded. The lock is active — leads are served from DB.',
        locked: true,
      }, { status: 423 }); // 423 Locked
    }

    // ── 3. Clear demo placeholder leads ──────────────────────────────────────
    const { rows: countBefore } = await pool.query(`SELECT COUNT(*) AS c FROM "Lead"`);
    console.log(`🗑️  Clearing ${countBefore[0].c} placeholder leads before real seed...`);
    await sql`DELETE FROM "Activity"`;
    await sql`DELETE FROM "Lead"`;

    // ── 4. Call REAPI — Engine 1 (New Purchase, last 90 days) ────────────────
    // BIA target ZIP codes — only leads from these 10 NJ ZIPs are fetched
    const TARGET_ZIPS = ['07722','07724','07726','07728','07730','07731','07733','07746','07748','08701'];

    const baseFilters = {
      ids_only: false,
      obfuscate: false,
      summary: false,
      state: 'NJ',
      zip: TARGET_ZIPS,
      flood_zone: false,
      vacant: false,
      pre_foreclosure: false,
      foreclosure: false,
      reo: false,
    };

    console.log('📤 Calling REAPI — Engine 1 (New Purchase)...');
    const [res1, res2] = await Promise.all([
      fetch(`${API_CONFIG.BASE_URL}/PropertySearch`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': API_CONFIG.API_KEY,
          'x-user-id': API_CONFIG.USER_ID,
        },
        body: JSON.stringify({
          ...baseFilters,
          size: 50,
          first_mortgage_recording_date_min: offsetDate(-90),
          first_mortgage_recording_date_max: offsetDate(0),
        }),
      }),
      fetch(`${API_CONFIG.BASE_URL}/PropertySearch`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': API_CONFIG.API_KEY,
          'x-user-id': API_CONFIG.USER_ID,
        },
        body: JSON.stringify({
          ...baseFilters,
          size: 50,
          first_mortgage_recording_date_min: '2022-01-01',
          first_mortgage_recording_date_max: offsetDate(-90),
        }),
      }),
    ]);

    if (!res1.ok) {
      const err = await res1.text();
      throw new Error(`REAPI Engine 1 failed: ${res1.status} — ${err}`);
    }
    if (!res2.ok) {
      const err = await res2.text();
      throw new Error(`REAPI Engine 2 failed: ${res2.status} — ${err}`);
    }

    const data1 = await res1.json();
    const data2 = await res2.json();

    const engine1Properties = data1.data || [];
    const engine2Properties = data2.data || [];
    const allProperties = [...engine1Properties, ...engine2Properties];

    console.log(`📥 Got ${engine1Properties.length} Engine-1 + ${engine2Properties.length} Engine-2 = ${allProperties.length} total`);

    if (allProperties.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'REAPI returned 0 properties. Check filters or account status.',
      }, { status: 502 });
    }

    // ── 5. Upsert into DB ────────────────────────────────────────────────────
    const ingestResult = await upsertLeads(allProperties);
    console.log('💾 Ingest result:', ingestResult);

    // ── 6. Enrich (carrier check + grading + pricing + coast distance) ────────
    const dbLeads = await getLeadsFromDb({ limit: 200 });
    const enrichResult = await enrichLeadBatch(dbLeads);
    console.log('🔍 Enrichment result:', enrichResult);

    // ── 7. Set lock — REAPI will NOT be called again until manually reset ─────
    await sql`
      INSERT INTO "AppConfig" ("key", "value", "updatedAt")
      VALUES ('api_seeded', 'true', NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = 'true', "updatedAt" = NOW()
    `;

    const { rows: countAfter } = await pool.query(`SELECT COUNT(*) AS c FROM "Lead"`);

    console.log(`✅ Seed complete. DB now has ${countAfter[0].c} real leads. REAPI is locked.`);

    return NextResponse.json({
      success: true,
      engine1: engine1Properties.length,
      engine2: engine2Properties.length,
      total: allProperties.length,
      ingest: ingestResult,
      enriched: enrichResult.enriched,
      dbTotal: Number(countAfter[0].c),
      message: `Successfully seeded ${allProperties.length} real NJ leads. REAPI is now locked — all future requests serve from DB.`,
    });

  } catch (error) {
    console.error('[admin/seed] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Seed failed' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/seed
 * Resets the REAPI lock so a new seed can be triggered.
 * Use only when explicitly permitted.
 */
export async function DELETE() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "AppConfig" (
        "key" TEXT PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`DELETE FROM "AppConfig" WHERE "key" = 'api_seeded'`;
    return NextResponse.json({ success: true, message: 'REAPI lock removed. Next POST to /api/admin/seed will fetch fresh data.' });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
