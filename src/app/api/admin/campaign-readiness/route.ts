import { NextResponse } from 'next/server';
import { campaignReadiness } from '@/services/campaignReadiness.service';

/**
 * GET /api/admin/campaign-readiness
 *
 * Every campaign, and what is stopping each one sending.
 *
 * Read-only, and slow on purpose: it asks the platform for every campaign's sequence,
 * contacts and mailboxes, and reads each sending mailbox's signature once. That is a lot of
 * round trips, and the alternative — caching an answer about whether it is safe to email
 * homeowners — is worse than waiting for it.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json({ success: true, campaigns: await campaignReadiness() });
  } catch (err) {
    console.error('GET /api/admin/campaign-readiness error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not check' },
      { status: 500 },
    );
  }
}
