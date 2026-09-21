import { sql } from '@/lib/neon';
import { listEmailsPage, replyToEmail, type VendorEmail } from '@/lib/integrations/leadCampaign';
import { suppress } from './suppression.service';
import { REPLY_CLASSES, type ReplyClass } from '@/lib/replyClasses';

/**
 * The reply inbox (directive Sec. 7.6, Sec. 10.8).
 *
 * ── Why the CRM needs one at all ────────────────────────────────────────────
 * Replies land in one of 28 sending mailboxes that nobody watches. The interim answer is
 * forwarding to a monitored inbox with a push alert, which gets the message in front of
 * Ruben but leaves the outcome nowhere: the classification, the household stop it triggers
 * and the response time all have to be typed somewhere afterwards, and anything typed
 * afterwards is data that eventually is not.
 *
 * Reading and replying in the same place the lead lives means the classification IS the
 * action — choosing "stop" writes the household suppression, choosing "wrong timing" sets
 * the re-engagement date — and the response clock is measured rather than remembered.
 *
 * ── Why threads are read live and not synced ────────────────────────────────
 * A synced copy is a second source of truth for the one thing a producer is reading while
 * talking to a customer, and it is wrong for exactly as long as the sync lag. The vendor
 * holds the messages; we hold what they MEAN — the classification, the suppression, the
 * confirmed address, the timings — because those are ours and must outlive the campaign.
 *
 * The webhook already records the facts every report is built on, so nothing here is on
 * the critical path for reporting. If this call fails, the inbox is unavailable for a
 * minute; no number moves.
 */

export type ThreadMessage = {
  id: string;
  direction: 'in' | 'out';
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  at: string | null;
};

export type ReplyThread = {
  threadId: string;
  /** The mailbox that owns the thread — a reply must come from this one to thread. */
  eaccount: string;
  /** The prospect, not us. */
  contactEmail: string;
  subject: string;
  messages: ThreadMessage[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** Awaiting us: the most recent message came from them. */
  awaitingReply: boolean;
  /** Minutes from their last message to our next one — Sec. 10.8 measures this. */
  responseMinutes: number | null;
  /** The uuid a reply must quote. Null when they have never written to us. */
  replyToUuid: string | null;
  // ── our side ──
  leadId: string | null;
  propertyId: string | null;
  ownerName: string | null;
  cohort: string | null;
  grade: string | null;
  classification: ReplyClass | null;
  classifiedAt: string | null;
  classifiedBy: string | null;
};

const bodyText = (e: VendorEmail): { text: string; html: string | null } => {
  const b = e.body;
  if (typeof b === 'string') return { text: b, html: null };
  const html = b?.html ?? null;
  const text = b?.text ?? (html ? html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') : '');
  return { text, html };
};

/**
 * Who sent it.
 *
 * NOT ue_type alone. The vendor uses at least three values — observed live: 1 for a
 * campaign send, 2 for the prospect's reply, 3 for a reply we sent by hand. Treating
 * "not 1" as inbound filed our own replies as the customer's, and the consequence was not
 * cosmetic: the reply box quotes the latest INBOUND message, so it would have replied to
 * us instead of to them and threaded the conversation at the wrong point.
 *
 * The sending mailbox is the fact that does not move. `eaccount` is our mailbox on every
 * row in a thread, so a message sent from it is ours whatever number the vendor attaches
 * to it next. ue_type stays only as a fallback for rows with no from address.
 */
const directionOf = (e: VendorEmail): 'in' | 'out' => {
  const from = String(e.from_address_email ?? '').toLowerCase();
  const ours = String(e.eaccount ?? '').toLowerCase();
  if (from && ours) return from === ours ? 'out' : 'in';
  return e.ue_type === 2 ? 'in' : 'out';
};

/**
 * Every thread that has at least one inbound message.
 *
 * Threads with no reply are not an inbox — they are the send log, which is reported
 * elsewhere. Including them would bury the handful of messages someone has to act on
 * under every email the cohort ever sent.
 */
export async function listThreads(
  opts: { limit?: number; campaignId?: string } = {},
): Promise<ReplyThread[]> {
  /**
   * Paged, because the platform caps a single call at 100 messages and an inbox needs
   * more than that. One send and one reply is two messages, so 100 covers roughly fifty
   * conversations — fine for a test, useless for a 660-lead cohort in its second week.
   *
   * Paging stops at MAX_PAGES rather than draining the account: this is a screen someone
   * is waiting on, and reading ten thousand messages to show the twenty that need
   * answering would make it unusable. Newest first, so the cap drops the oldest threads,
   * which are the ones least likely to still need a reply.
   */
  const want = opts.limit ?? 400;
  const MAX_PAGES = 10;
  const emails: VendorEmail[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && emails.length < want; page++) {
    const { items, nextCursor } = await listEmailsPage({
      limit: 100, startingAfter: cursor, campaignId: opts.campaignId,
    });
    emails.push(...items);
    if (!nextCursor || !items.length) break;
    cursor = nextCursor;
  }

  const byThread = new Map<string, VendorEmail[]>();
  for (const e of emails) {
    const k = e.thread_id || e.id;
    if (!k) continue;
    const arr = byThread.get(k) ?? [];
    arr.push(e);
    byThread.set(k, arr);
  }

  const threads: ReplyThread[] = [];
  for (const [threadId, msgs] of byThread) {
    msgs.sort((a, b) => String(a.timestamp_email ?? '').localeCompare(String(b.timestamp_email ?? '')));
    const messages: ThreadMessage[] = msgs.map((e) => {
      const { text, html } = bodyText(e);
      return {
        id: e.id,
        direction: directionOf(e),
        from: e.from_address_email ?? e.eaccount ?? '',
        to: e.to_address_email_list ?? '',
        subject: e.subject ?? '',
        text, html,
        at: e.timestamp_email ?? null,
      };
    });

    const inbound = messages.filter((m) => m.direction === 'in');
    if (!inbound.length) continue;

    const eaccount = msgs.find((m) => m.eaccount)?.eaccount ?? '';
    // The prospect is whoever is not our mailbox.
    const contactEmail = (inbound[0].from || '').toLowerCase();
    const lastIn = inbound[inbound.length - 1];
    const outAfter = messages.filter((m) => m.direction === 'out' && m.at && lastIn.at && m.at > lastIn.at);
    const lastOut = messages.filter((m) => m.direction === 'out').pop() ?? null;

    threads.push({
      threadId,
      eaccount,
      contactEmail,
      subject: messages[0]?.subject ?? '',
      messages,
      lastInboundAt: lastIn.at,
      lastOutboundAt: lastOut?.at ?? null,
      awaitingReply: outAfter.length === 0,
      responseMinutes: outAfter.length && lastIn.at
        ? Math.round((new Date(outAfter[0].at!).getTime() - new Date(lastIn.at).getTime()) / 60000)
        : null,
      // Always the LATEST inbound: replying to an older one threads the conversation at
      // the wrong point and the customer sees an answer to something they moved past.
      replyToUuid: lastIn.id,
      leadId: null, propertyId: null, ownerName: null, cohort: null, grade: null,
      classification: null, classifiedAt: null, classifiedBy: null,
    });
  }

  await attachLeads(threads);
  // Waiting on us first, then most recent — the queue reads as work, not as history.
  threads.sort((a, b) => {
    if (a.awaitingReply !== b.awaitingReply) return a.awaitingReply ? -1 : 1;
    return String(b.lastInboundAt ?? '').localeCompare(String(a.lastInboundAt ?? ''));
  });
  return threads;
}

/**
 * Join each thread to the lead it belongs to.
 *
 * Matched on the OutreachEvent for that recipient — the row the CRM created when it
 * pushed the send — rather than by searching the Lead table for the address. A lead can
 * hold several addresses and two households can share one, so the send record is the only
 * thing that says which card this conversation actually belongs to.
 */
async function attachLeads(threads: ReplyThread[]): Promise<void> {
  const emails = [...new Set(threads.map((t) => t.contactEmail).filter(Boolean))];
  if (!emails.length) return;

  const rows = await sql`
    SELECT LOWER(e."recipientEmail") AS email, e."leadId", e."propertyId",
           e."cohort", e."replyClass", e."replyClassAt"::text AS "replyClassAt", e."replyClassBy",
           l."owner1FirstName", l."owner1LastName", COALESCE(l."manualGrade", l."grade") AS grade
      FROM "OutreachEvent" e
      LEFT JOIN "Lead" l ON l."id" = e."leadId"
     WHERE LOWER(e."recipientEmail") = ANY(${emails})` as Array<Record<string, string | null>>;

  const byEmail = new Map(rows.map((r) => [r.email as string, r]));
  for (const t of threads) {
    const r = byEmail.get(t.contactEmail);
    if (!r) continue;
    t.leadId = r.leadId ?? null;
    t.propertyId = r.propertyId ?? null;
    t.cohort = r.cohort ?? null;
    t.grade = r.grade ?? null;
    t.ownerName = [r.owner1FirstName, r.owner1LastName].filter(Boolean).join(' ') || null;
    t.classification = (r.replyClass as ReplyClass) ?? null;
    t.classifiedAt = r.replyClassAt ?? null;
    t.classifiedBy = r.replyClassBy ?? null;
  }
}

/** Send a reply into a thread, and record that we did. */
export async function sendReply(opts: {
  replyToUuid: string;
  eaccount: string;
  subject: string;
  text: string;
  leadId?: string | null;
  contactEmail?: string | null;
  by?: string | null;
}): Promise<{ id: string }> {
  const subject = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`;
  const sent = await replyToEmail({
    replyToUuid: opts.replyToUuid,
    eaccount: opts.eaccount,
    subject,
    text: opts.text,
  });

  if (opts.leadId) {
    await sql`
      INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
      VALUES (${globalThis.crypto.randomUUID()}, ${opts.leadId}, 'email',
              ${`Replied from the CRM to ${opts.contactEmail ?? ''}: ${opts.text.slice(0, 300)}`},
              ${opts.by ?? 'crm'}, NOW())`;
  }
  return { id: sent.id };
}

/**
 * Classify a reply, and do what the classification means (Sec. 7.6).
 *
 * The classification is not a label on a message, it is an instruction. Recording "stop"
 * without suppressing the household would leave a card that says the customer asked us to
 * stop while the next cohort mails them anyway — which is the exact failure the whole
 * suppression layer exists to prevent. So the write and the action happen together.
 */
export async function classifyReply(opts: {
  leadId: string;
  contactEmail: string;
  klass: ReplyClass;
  by?: string | null;
}): Promise<{ suppressed: boolean; scope?: string }> {
  const spec = REPLY_CLASSES.find((c) => c.key === opts.klass);
  if (!spec) throw new Error(`Unknown reply classification: ${opts.klass}`);

  await sql`
    UPDATE "OutreachEvent"
       SET "replyClass" = ${opts.klass}, "replyClassAt" = NOW(), "replyClassBy" = ${opts.by ?? null},
           "updatedAt" = NOW()
     WHERE LOWER("recipientEmail") = ${opts.contactEmail.toLowerCase()}`;

  const [lead] = await sql`
    SELECT "id","addressStreet","addressZip" FROM "Lead" WHERE "id" = ${opts.leadId}` as Array<Record<string, unknown>>;

  let suppressed = false;
  let scope: string | undefined;
  if (spec.suppresses && lead) {
    const r = await suppress({
      lead, email: opts.contactEmail, reason: spec.suppresses,
      source: 'crm', createdBy: opts.by ?? null, note: `reply classified "${spec.label}"`,
    });
    suppressed = true;
    scope = r.scope;
  }

  if (spec.reEngage && lead) {
    // "Call me at renewal" — Sec. 7.6 puts them back 60 days before the next effective
    // date. Nothing is discarded; it is scheduled.
    await sql`
      UPDATE "Lead"
         SET "revisitFlag" = TRUE,
             "revisitDate" = ("effectiveDate"::date - INTERVAL '60 days'),
             "revisitNote" = ${`Reply: ${spec.label}`}
       WHERE "id" = ${opts.leadId}`;
  }

  await sql`
    INSERT INTO "Activity" ("id","leadId","type","content","createdBy","createdAt")
    VALUES (${globalThis.crypto.randomUUID()}, ${opts.leadId}, 'note',
            ${`Reply classified: ${spec.label}${suppressed ? ` — household suppressed (${scope})` : ''}`},
            ${opts.by ?? 'crm'}, NOW())`;

  return { suppressed, scope };
}
