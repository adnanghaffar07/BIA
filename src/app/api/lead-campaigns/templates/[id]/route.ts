import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/neon';
import { requireCampaignAccess } from '@/lib/integrations/campaignAccess';

/**
 * One template.
 *
 *   PATCH  → rename, or replace its subject and body
 *   DELETE → remove it
 *
 * Deleting a template does NOT touch any campaign that was built from it: applying a
 * template copies its text into the sequence step, so the campaign owns its own copy
 * from that moment. That is the point — editing a template later must not silently
 * rewrite live campaigns that are already sending.
 */

export const maxDuration = 10;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const name = body?.name === undefined ? undefined : String(body.name).trim();
    const subject = body?.subject === undefined ? undefined : String(body.subject);
    const text = body?.body === undefined ? undefined : String(body.body);

    if (name !== undefined && !name) {
      return NextResponse.json({ success: false, error: 'A template needs a name.' }, { status: 400 });
    }

    const rows = await sql`SELECT "id" FROM "EmailTemplate" WHERE "id" = ${id}` as Array<{ id: string }>;
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'That template no longer exists.' }, { status: 404 });
    }

    if (name !== undefined) {
      const clash = await sql`
        SELECT "id" FROM "EmailTemplate" WHERE LOWER("name") = LOWER(${name}) AND "id" <> ${id} LIMIT 1
      ` as Array<{ id: string }>;
      if (clash.length) {
        return NextResponse.json(
          { success: false, error: `Another template is already called "${name}".` },
          { status: 409 },
        );
      }
    }

    await sql`
      UPDATE "EmailTemplate"
      SET "name"    = COALESCE(${name ?? null}, "name"),
          "subject" = COALESCE(${subject ?? null}, "subject"),
          "body"    = COALESCE(${text ?? null}, "body"),
          "updatedAt" = NOW()
      WHERE "id" = ${id}
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not update the template' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  const { id } = await params;
  const rows = await sql`DELETE FROM "EmailTemplate" WHERE "id" = ${id} RETURNING "name"` as Array<{ name: string }>;
  if (!rows.length) {
    return NextResponse.json({ success: false, error: 'That template no longer exists.' }, { status: 404 });
  }
  return NextResponse.json({ success: true, deleted: rows[0].name });
}
