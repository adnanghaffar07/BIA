/**
 * Is the campaign webhook actually delivering?
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/webhook-status.mjs
 *         ... --watch        poll every 10s until something arrives
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The campaign tool's delivery log is behind a plan upgrade, so the vendor side gives no
 * visibility at all: a webhook whose URL is wrong, whose key was rotated, or whose
 * endpoint is down still shows a green "Active" dot, because from the tool’s point of
 * view the request left successfully. The CRM is therefore the ONLY place that knows
 * whether anything is arriving.
 *
 * That makes silence ambiguous — "nothing has been sent yet" and "everything is being
 * rejected" look identical. This prints the last thing we heard and when, so the
 * difference is visible within one send rather than at the end of a cohort.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';

const watch = process.argv.includes('--watch');

const ago = (d) => {
  if (!d) return 'never';
  const secs = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
};

async function report() {
  // Every column the receiver stamps. A non-null value means that event type has been
  // received at least once — which is the only proof of delivery available.
  const [t] = await sql`
    SELECT COUNT(*)::int                                            AS events,
           COUNT(*) FILTER (WHERE "sentAt"         IS NOT NULL)::int AS sent,
           COUNT(*) FILTER (WHERE "deliveredAt"    IS NOT NULL)::int AS delivered,
           COUNT(*) FILTER (WHERE "openedAt"       IS NOT NULL)::int AS opened,
           COUNT(*) FILTER (WHERE "clickedAt"      IS NOT NULL)::int AS clicked,
           COUNT(*) FILTER (WHERE "repliedAt"      IS NOT NULL)::int AS replied,
           COUNT(*) FILTER (WHERE "bouncedAt"      IS NOT NULL)::int AS bounced,
           COUNT(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL)::int AS unsubscribed,
           COUNT(*) FILTER (WHERE "complainedAt"   IS NOT NULL)::int AS complained,
           MAX("updatedAt")                                          AS "lastTouch"
      FROM "OutreachEvent"`;

  const [s] = await sql`
    SELECT COUNT(*)::int n, MAX("createdAt") AS last FROM "Suppression" WHERE "releasedAt" IS NULL`;

  console.log(`\n${new Date().toLocaleTimeString()}  —  campaign webhook status`);
  console.log(`  outreach events on file : ${t.events}`);
  if (t.events) {
    console.log(`    sent ${t.sent} · delivered ${t.delivered} · opened ${t.opened} · clicked ${t.clicked}`);
    console.log(`    replied ${t.replied} · bounced ${t.bounced} · unsubscribed ${t.unsubscribed} · complaints ${t.complained}`);
  }
  console.log(`  last event touched      : ${ago(t.lastTouch)}`);
  console.log(`  active suppressions     : ${s.n}${s.n ? ` (most recent ${ago(s.last)})` : ''}`);

  if (!t.events) {
    console.log('\n  Nothing has arrived yet. That is expected until the first send —');
    console.log('  it does NOT distinguish "not sent" from "being rejected". Send one');
    console.log('  email and re-run: an "Email Sent" webhook fires on every send, so a');
    console.log('  working integration shows up here within seconds.');
  }
  return t.events;
}

if (!watch) { await report(); process.exit(0); }

console.log('watching — Ctrl-C to stop');
for (;;) {
  if (await report()) { console.log('\n  Events are arriving. The webhook is delivering.'); break; }
  await new Promise((r) => setTimeout(r, 10_000));
}
