import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/neon';
import { requireCampaignAccess } from '@/lib/integrations/campaignAccess';

/**
 * Reusable email templates.
 *
 *   GET  → every template, most recently updated first
 *   POST → save one (creates, or overwrites by name when `overwrite` is set)
 *
 * Stored here rather than on the sending platform: its /email-templates endpoint
 * accepts a subject and silently discards it, and offers no PATCH or GET-by-id. See
 * migrations/019 for the full reasoning.
 *
 * Templates are shared across the workspace on purpose — the point of writing copy once
 * is that the next producer can use it. createdBy is provenance, not ownership.
 */

export const maxDuration = 10;

/** Long enough for real cold-outreach copy; short enough that a paste-bomb is refused. */
const MAX_BODY = 20_000;
const MAX_NAME = 120;

export async function GET(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  const rows = await sql`
    SELECT "id", "name", "subject", "body", "createdBy", "updatedAt"
    FROM "EmailTemplate"
    ORDER BY "updatedAt" DESC
  ` as Array<Record<string, unknown>>;

  return NextResponse.json({ success: true, templates: rows });
}

export async function POST(request: NextRequest) {
  const gate = await requireCampaignAccess(request);
  if ('response' in gate) return gate.response;

  try {
    const body = await request.json();
    const name = String(body?.name ?? '').trim();
    const subject = String(body?.subject ?? '');
    const text = String(body?.body ?? '');
    const overwrite = body?.overwrite === true;

    if (!name) {
      return NextResponse.json({ success: false, error: 'Give the template a name.' }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json({ success: false, error: `Name is longer than ${MAX_NAME} characters.` }, { status: 400 });
    }
    // A template with no body is not a template, and saving one would put an empty
    // option in the picker that silently blanks whatever it is applied to.
    if (!subject.trim() || !text.trim()) {
      return NextResponse.json(
        { success: false, error: 'A template needs both a subject and a body.' },
        { status: 400 },
      );
    }
    if (text.length > MAX_BODY) {
      return NextResponse.json({ success: false, error: 'That body is too long to save.' }, { status: 400 });
    }

    const existing = await sql`
      SELECT "id" FROM "EmailTemplate" WHERE LOWER("name") = LOWER(${name}) LIMIT 1
    ` as Array<{ id: string }>;

    if (existing.length && !overwrite) {
      // Reported rather than silently replaced: overwriting copy someone else relies on
      // is not something to do on the strength of a matching name alone.
      return NextResponse.json(
        { success: false, error: `A template called "${name}" already exists.`, conflict: true },
        { status: 409 },
      );
    }

    if (existing.length) {
      await sql`
        UPDATE "EmailTemplate"
        SET "subject" = ${subject}, "body" = ${text}, "updatedAt" = NOW()
        WHERE "id" = ${existing[0].id}
      `;
      return NextResponse.json({ success: true, id: existing[0].id, replaced: true });
    }

    const id = crypto.randomUUID();
    await sql`
      INSERT INTO "EmailTemplate" ("id", "name", "subject", "body", "createdBy")
      VALUES (${id}, ${name}, ${subject}, ${text}, ${gate.actor?.email ?? null})
    `;
    return NextResponse.json({ success: true, id, replaced: false });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save the template' },
      { status: 500 },
    );
  }
}
