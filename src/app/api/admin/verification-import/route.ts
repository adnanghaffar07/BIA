import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { planVerificationImport, applyVerificationImport } from '@/services/verificationImport.service';
import { sql } from '@/lib/neon';

/**
 * Import a verifier's result file from the screen.
 *
 *   POST /api/admin/verification-import          { csv }           — plan only, writes nothing
 *   POST /api/admin/verification-import?commit=1 { csv, label }    — write it
 *
 * Admin/superadmin only (enforced by middleware on /api/admin).
 *
 * ── Why the file is posted as text ──────────────────────────────────────────
 * The browser reads it and sends the contents. No multipart handling, no temporary file on
 * a serverless box that may not be the one the next request lands on, and nothing stored
 * anywhere between choosing the file and confirming the import — the plan is recomputed
 * from the same text on the commit call.
 *
 * ── Why the plan is recomputed rather than trusted ──────────────────────────
 * The commit could have taken the plan the client already has, which would be faster and
 * would let a doctored payload write any verdict against any address. The file is the only
 * input; everything else is derived here.
 */
export const dynamic = 'force-dynamic';

/** Roughly 60k rows of "email,status". Beyond that it belongs on the command line. */
const MAX_BYTES = 4_000_000;

export async function POST(request: NextRequest) {
  try {
    const commit = request.nextUrl.searchParams.get('commit') === '1';
    const body = await request.json().catch(() => ({}));
    /**
     * Base64, because an .xlsx is a zip.
     *
     * The first version took the file as a string. A workbook read as text becomes
     * mojibake, which a CSV parser splits into thousands of nonsense columns — and the
     * screen printed those back as "headings found". `csv` is still accepted so the
     * existing tests and any caller posting plain text keep working.
     */
    const b64 = typeof body?.fileB64 === 'string' ? body.fileB64 : null;
    const buf = b64
      ? Buffer.from(b64, 'base64')
      : Buffer.from(String(body?.csv ?? ''), 'utf8');

    if (!buf.length) {
      return NextResponse.json({ success: false, error: 'That file is empty.' }, { status: 400 });
    }
    if (buf.length > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: `That file is ${(buf.length / 1e6).toFixed(1)} MB. Files this size go through scripts/import-zerobounce.mjs.` },
        { status: 400 },
      );
    }

    const plan = await planVerificationImport(buf);
    if (plan.error) {
      return NextResponse.json({ success: false, error: plan.error, headers: plan.headers }, { status: 400 });
    }

    /**
     * The preview carries the chosen columns and a sample, not the whole plan.
     *
     * Sending 526 rows back so the browser can show three is waste, and the commit call
     * re-reads the file anyway. What it MUST carry is which column was read as the status,
     * because that is the one mistake nobody catches afterwards.
     */
    const preview = {
      headers: plan.headers,
      emailColumn: plan.headers[plan.emailCol] ?? null,
      statusColumn: plan.headers[plan.statusCol] ?? null,
      subStatusColumn: plan.subCol >= 0 ? plan.headers[plan.subCol] : null,
      counts: plan.counts,
      byStatus: plan.byStatus,
      // One entry per email/status pair found, so a workbook's five pairs are visible as
      // five rows rather than collapsed into a single count nobody can check.
      sources: plan.sources,
      willWrite: plan.rows.length,
      sample: plan.rows.slice(0, 5).map((r) => ({
        email: r.email, status: r.status, matchedLead: Boolean(r.leadId), role: r.personRole,
      })),
    };

    if (!commit) return NextResponse.json({ success: true, committed: false, ...preview });

    const actor = actorLabel(await getSessionUser(request));
    const label = String(body?.label ?? '').trim().slice(0, 120) || null;
    const imported = await applyVerificationImport(plan, { label, source: 'zerobounce' });

    const [after] = await sql`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "deliverable")::int AS ok
        FROM "EmailVerification"` as Array<{ n: number; ok: number }>;

    return NextResponse.json({
      success: true, committed: true, imported, by: actor, label,
      total: after.n, deliverable: after.ok,
      ...preview,
    });
  } catch (error) {
    console.error('POST /api/admin/verification-import error:', error);
    return NextResponse.json({ success: false, error: 'Could not read that file' }, { status: 500 });
  }
}
