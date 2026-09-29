import { sql } from '@/lib/neon';
import { cohortCode, cohortLabel } from './cohort';

/**
 * Tell Ruben and Frank the moment somebody engages.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Frank, 29 Sep 2026: "anytime there's real engagement, whether it's on the phone or the
 * email, it should both correlate into a workflow... as soon as an engagement, an email is
 * sent to Ruben, he knows how to get into the card, and it's pretty instantaneous."
 *
 * And on why a screen is not enough: "I have a feeling these may get buried, so a good
 * fail-safety is having them directly emailed to us."
 *
 * The replies already land in the CRM. What was missing is the push — somebody has to be
 * looking at the right screen to know a homeowner is waiting, and on a renewal inside three
 * weeks the cost of finding out tomorrow is the account.
 *
 * ── What the message has to carry ───────────────────────────────────────────
 * Frank again: "it's got to have the lead ID, what the effective date is, which cohort is
 * it, what's the name, what's the address." He is reading it on a phone, between calls, and
 * deciding whether to ring someone — so everything needed for that decision is in the body
 * and nothing requires opening the CRM first. The link is there for when he does.
 *
 * ── Delivery is deliberately a thin seam ────────────────────────────────────
 * This composes the notification and hands it to whatever sender is configured. The project
 * has no mail dependency and no SMTP credentials, and those are not a developer's to invent:
 * they belong to Burlington's own mail. So the sender is an HTTP endpoint named by
 * environment variable, and until one is set the notification is still COMPOSED and RECORDED
 * against the lead — the Activity row is the fallback, so an engagement is never silently
 * lost because a credential is missing.
 */

export type EngagementKind = 'reply' | 'click' | 'call';

export type EngagementNotice = {
  leadId: string;
  subject: string;
  body: string;
  /** Who it is addressed to, from NOTIFY_ENGAGEMENT_TO. Empty when nobody is configured. */
  to: string[];
  /** False when it was recorded but not sent — no endpoint, or the send failed. */
  delivered: boolean;
  why?: string;
};

/**
 * Where the CRM lives, for the link back to the card.
 *
 * VERCEL_URL is set automatically on every deployment and carries no scheme, so the link
 * works in production with nothing configured. APP_URL overrides it for a custom domain —
 * worth setting, because VERCEL_URL names the immutable deployment rather than the address
 * Frank has bookmarked, and a link that works today and 404s after the next deploy is worse
 * than one that never worked.
 */
function appUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : '';
}

/**
 * Who gets told.
 *
 * Comma-separated in NOTIFY_ENGAGEMENT_TO. Frank named himself and Ruben on the call; the
 * addresses are theirs to give rather than mine to guess, and a notification sent to a
 * wrong address is worse than one not sent — it goes on looking like it works.
 */
function recipients(): string[] {
  return String(process.env.NOTIFY_ENGAGEMENT_TO ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

const money = (v: unknown) => (v == null || v === '' ? null : `$${Math.round(Number(v))}`);

/**
 * Build the notification for one engagement.
 *
 * Exported and pure-ish (one read, no writes) so the content can be checked without sending
 * anything to anybody.
 */
export async function composeEngagementNotice(input: {
  leadId: string;
  kind: EngagementKind;
  /** The address that engaged, or the number that was called. */
  who?: string | null;
  /** Reply text, or the call outcome. */
  detail?: string | null;
}): Promise<EngagementNotice | null> {
  const rows = await sql`
    SELECT "id","propertyId","cohort","effectiveDate","grade","manualGrade","status",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
           "addressStreet","addressCity","addressState","addressZip",
           "phone1","phone2","indicativeBandLow","indicativeBandHigh"
      FROM "Lead" WHERE "id" = ${input.leadId}` as Array<Record<string, any>>;
  const l = rows[0];
  if (!l) return null;

  const insured = [l.owner1FirstName, l.owner1LastName].filter(Boolean).join(' ');
  const co = [l.owner2FirstName, l.owner2LastName].filter(Boolean).join(' ');
  const address = [l.addressStreet, l.addressCity, l.addressState, l.addressZip]
    .filter(Boolean).join(', ');
  const code = l.cohort ? (cohortCode(String(l.cohort)) ?? String(l.cohort)) : null;
  const band = money(l.indicativeBandLow) && money(l.indicativeBandHigh)
    ? `${money(l.indicativeBandLow)}–${money(l.indicativeBandHigh)}`
    : 'not set';

  const what = input.kind === 'reply' ? 'replied to an email'
    : input.kind === 'click' ? 'clicked a link in an email'
    : 'was reached on the phone';

  /**
   * The cohort leads the subject line.
   *
   * Frank triages by renewal proximity — "if it's closer to the effective date, that means
   * it's more pressing" — so the thing he sorts by is the first thing he reads, before he
   * opens anything.
   */
  const subject = `[${code ?? 'no cohort'}] ${insured || 'Unknown'} ${what}`
    + (l.effectiveDate ? ` — renews ${String(l.effectiveDate).slice(0, 10)}` : '');

  const link = appUrl() ? `${appUrl()}/leads/${l.id}` : `/leads/${l.id}`;

  const body = [
    `${insured || 'Unknown owner'} ${what}.`,
    '',
    `Address        ${address || '—'}`,
    `Renews         ${l.effectiveDate ? String(l.effectiveDate).slice(0, 10) : '—'}`
      + (l.cohort ? `  (${code} · ${cohortLabel(String(l.cohort))})` : ''),
    `Insured        ${insured || '—'}`,
    co ? `Co-insured     ${co}` : null,
    `Phone          ${[l.phone1, l.phone2].filter(Boolean).join(' · ') || '—'}`,
    `Band price     ${band}`,
    `Grade          ${l.manualGrade ?? l.grade ?? '—'}   ·   Status  ${l.status ?? '—'}`,
    '',
    input.who ? `From           ${input.who}` : null,
    input.detail ? `\n"${String(input.detail).trim().slice(0, 600)}"` : null,
    '',
    `Lead ID        ${l.id}`,
    l.propertyId ? `Property ID    ${l.propertyId}` : null,
    '',
    `Open the card: ${link}`,
  ].filter((x) => x !== null).join('\n');

  return { leadId: String(l.id), subject, body, to: recipients(), delivered: false };
}

/**
 * Compose, record, and send if a sender is configured.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 * Called from the reply webhook and from the call log. A notification that cannot be
 * delivered must not take down the thing that caused it: losing the record of a homeowner's
 * reply because an SMTP relay was down would be a far worse outcome than a late email, and
 * the reply is already safe in the CRM by the time this runs.
 */
export async function notifyEngagement(input: {
  leadId: string;
  kind: EngagementKind;
  who?: string | null;
  detail?: string | null;
}): Promise<EngagementNotice | null> {
  let notice: EngagementNotice | null = null;
  try {
    notice = await composeEngagementNotice(input);
    if (!notice) return null;

    const endpoint = String(process.env.NOTIFY_ENGAGEMENT_URL ?? '').trim();
    if (!endpoint) {
      notice.why = 'NOTIFY_ENGAGEMENT_URL is not set — recorded on the lead only';
    } else if (!notice.to.length) {
      notice.why = 'NOTIFY_ENGAGEMENT_TO is not set — nobody to send to';
    } else {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(process.env.NOTIFY_ENGAGEMENT_KEY
            ? { authorization: `Bearer ${process.env.NOTIFY_ENGAGEMENT_KEY}` }
            : {}),
        },
        body: JSON.stringify({ to: notice.to, subject: notice.subject, text: notice.body }),
      });
      notice.delivered = res.ok;
      if (!res.ok) notice.why = `sender returned ${res.status}`;
    }

    /**
     * Recorded on the lead either way.
     *
     * This is the fail-safety behind the fail-safety: if the mail never goes, the engagement
     * and everything about it is still on the card's own timeline, where the producer
     * working that card will meet it.
     */
    await sql`
      INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
      VALUES (gen_random_uuid()::text, ${notice.leadId}, 'engagement_alert',
              ${`${notice.subject}${notice.delivered ? ` — sent to ${notice.to.join(', ')}` : ` — NOT SENT (${notice.why})`}`},
              'engagement notifier', NOW())`;
  } catch (e) {
    console.error('[engagementNotify] could not notify for', input.leadId, e);
  }
  return notice;
}
