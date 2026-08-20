import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/neon';
import { updateLead } from '@/services/storage.service';
import { runTracerfy } from '@/services/tracerfy.service';
import { compareOwnerNames } from '@/services/ownerNameMatch.service';

/**
 * Retroactive Tracerfy skip-trace batch (Frank Aug-2026). Runs the NEW skip trace across
 * rated accounts from an effective-date floor (default 10/5) to fill contacts + the
 * co-insured (spouse) phone/email + DOB, and to QC insured names against Tracerfy.
 *
 *   GET  /api/admin/skiptrace-batch[?from=YYYY-MM-DD]  → DRY RUN (free) — count + credit est.
 *   POST /api/admin/skiptrace-batch[?from=YYYY-MM-DD]  → REAL RUN — 5 Tracerfy credits/account.
 *
 * Returns the name-discrepancy list (address / old name / Tracerfy name) for carrier-portal
 * fixes, plus a contact-coverage summary and the no-email list. SuperAdmin only (middleware).
 */
const GAP_MS = 200;
const DEFAULT_FROM = '2026-10-05';

function ratedInRange(from: string) {
  return sql`
    SELECT * FROM "Lead"
    WHERE "status" = 'rated' AND "effectiveDate" >= ${from}
    ORDER BY "effectiveDate"
  ` as Promise<any[]>;
}

const fullName = (f: any, l: any) => [String(f ?? '').replace(/\bnull\b/gi, '').trim(), String(l ?? '').trim()].filter(Boolean).join(' ').trim();

export async function GET(req: NextRequest) {
  try {
    const from = req.nextUrl.searchParams.get('from') || DEFAULT_FROM;
    const rows = await ratedInRange(from);
    return NextResponse.json({
      success: true, dryRun: true, from,
      accounts: rows.length,
      estimatedCredits: rows.length * 5,
      note: `Would run Tracerfy on ${rows.length} rated accounts effective ${from}+ (≈${rows.length * 5} credits).`,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Dry run failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const from = req.nextUrl.searchParams.get('from') || DEFAULT_FROM;
    const rows = await ratedInRange(from);

    const discrepancies: { address: string; oldName: string; tracerfyName: string; verdict: string }[] = [];
    const noEmail: { address: string; owner: string; hasPhone: boolean }[] = [];
    const coverage = { total: rows.length, processed: 0, hit: 0, both: 0, phoneOnly: 0, emailOnly: 0, neither: 0, spouseCaptured: 0 };

    for (const lead of rows) {
      let result: any;
      try { result = await runTracerfy(lead); } catch { await new Promise((r) => setTimeout(r, GAP_MS)); continue; } // 5 credits
      coverage.processed++;
      if (!result.matched) { await new Promise((r) => setTimeout(r, GAP_MS)); continue; }
      coverage.hit++;

      // Insured-name QC — Tracerfy's property owner is treated as the truth (Frank).
      const persons: any[] = Array.isArray(result.raw?.persons) ? result.raw.persons : [];
      const owner = persons.find((p) => p.property_owner) ?? persons[0];
      const nameUpdate: Record<string, any> = {};
      if (owner) {
        const onFile = { first: lead.owner1FirstName, last: lead.owner1LastName };
        const cmp = compareOwnerNames(onFile, `${owner.last_name}, ${owner.first_name}`);
        if (cmp.result === 'mismatch' && (owner.first_name || owner.last_name)) {
          discrepancies.push({
            address: [lead.addressStreet, lead.addressCity, lead.addressZip].filter(Boolean).join(', '),
            oldName: fullName(lead.owner1FirstName, lead.owner1LastName) || '(none)',
            tracerfyName: fullName(owner.first_name, owner.last_name),
            verdict: cmp.result,
          });
          nameUpdate.owner1FirstName = owner.first_name;
          nameUpdate.owner1LastName = owner.last_name;
        }
      }

      // Contacts — fill empty slots only (the book was purged of REAPI contacts, so mostly empty).
      const update: Record<string, any> = {
        skipTraced: true, skipTracedAt: new Date(), skipTraceData: result.raw,
        ...result.insuredPatch, ...nameUpdate,
      };
      if (result.phones[0] && !lead.phone1) update.phone1 = result.phones[0];
      if (result.phones[1] && !lead.phone2) update.phone2 = result.phones[1];
      if (result.emails[0] && !lead.email1) update.email1 = result.emails[0];
      if (result.emails[1] && !lead.email2) update.email2 = result.emails[1];

      await updateLead(lead.propertyId, update);

      // Coverage tally from the resulting state.
      const hasPhone = !!(update.phone1 || lead.phone1);
      const hasEmail = !!(update.email1 || lead.email1);
      if (hasPhone && hasEmail) coverage.both++;
      else if (hasPhone) coverage.phoneOnly++;
      else if (hasEmail) coverage.emailOnly++;
      else coverage.neither++;
      if (!hasEmail) noEmail.push({ address: [lead.addressStreet, lead.addressZip].filter(Boolean).join(' '), owner: fullName(lead.owner1FirstName, lead.owner1LastName), hasPhone });
      if (result.insuredPatch?.owner2Phone || result.insuredPatch?.owner2Email) coverage.spouseCaptured++;

      await new Promise((r) => setTimeout(r, GAP_MS));
    }

    return NextResponse.json({
      success: true, dryRun: false, from,
      creditsSpent: coverage.processed * 5,
      coverage, discrepancies, noEmail,
    });
  } catch (err: any) {
    console.error('POST /api/admin/skiptrace-batch error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Batch failed' }, { status: 500 });
  }
}
