import { listCampaigns, listLeadsInCampaign, updateLeadVariables } from '@/lib/integrations/leadCampaign';
import { globalMergeVars } from './globalMergeVars.service';

/**
 * Put the shared variable values onto every contact on the sending platform.
 *
 * ── Why this has to exist at all ────────────────────────────────────────────
 * The platform has no workspace-level variable. A merge field is resolved from the CONTACT
 * it is sending to, and nowhere else, so "the office address" is not a thing that can be
 * defined once over there — it is a string that has to be written onto all 757 contacts.
 *
 * custom_variables are also written when a contact is created and never again, so a value
 * set or corrected afterwards reaches nobody already uploaded. Everything then looks right on
 * every screen and the email still arrives with a hole in it.
 *
 * ── Why it works in chunks ──────────────────────────────────────────────────
 * One PATCH per contact, and each one read back, because the platform answers 200 to a write
 * that stored nothing. That is ~1,500 calls across the book — far past what a single web
 * request should hold open. So a call does a bounded batch and says how many remain, and the
 * screen calls again until there are none. A closed laptop resumes rather than starting over.
 *
 * ── Why it only sends the shared values ─────────────────────────────────────
 * A PATCH MERGES custom_variables. Sending the shared set alone therefore cannot disturb the
 * per-lead values a push already put on a contact — and per-lead values are not this
 * function's business: they differ per household and come from pushing that lead.
 */

export type PushPreview = {
  campaigns: number;
  contacts: number;
  /** Contacts already carrying every shared value, so nothing needs writing to them. */
  upToDate: number;
  pending: number;
  variables: string[];
};

export type PushResult = {
  processed: number;
  updated: number;
  /** Contacts whose read-back did not match what was written. */
  failed: Array<{ email: string; fields: string[] }>;
  remaining: number;
};

/** Everything the platform holds for one contact, whichever shape it came back in. */
function heldBy(contact: unknown): Record<string, unknown> {
  const c = contact as { payload?: Record<string, unknown>; custom_variables?: Record<string, unknown> };
  return c?.payload ?? c?.custom_variables ?? {};
}

/**
 * A contact needs writing to when any shared value is absent or different.
 *
 * Compared as strings: the platform returns everything as text, and a number written as 725
 * comes back as "725". Comparing loosely here would either rewrite every contact on every run
 * or never rewrite a corrected figure.
 */
function needsUpdate(contact: unknown, globals: Record<string, string>): boolean {
  const held = heldBy(contact);
  return Object.entries(globals).some(([k, v]) => String(held[k] ?? '') !== String(v));
}

/** What a run would do, without doing any of it. */
export async function previewGlobalsPush(): Promise<PushPreview> {
  const globals = await globalMergeVars();
  const out: PushPreview = {
    campaigns: 0, contacts: 0, upToDate: 0, pending: 0, variables: Object.keys(globals),
  };
  if (!out.variables.length) return out;

  const campaigns = await listCampaigns();
  out.campaigns = campaigns.length;
  for (const c of campaigns) {
    for (const contact of await listLeadsInCampaign(String(c.id))) {
      out.contacts++;
      if (needsUpdate(contact, globals)) out.pending++;
      else out.upToDate++;
    }
  }
  return out;
}

/**
 * Write the shared values onto the next batch of contacts that need them.
 *
 * Idempotent and resumable: a contact already carrying every value is passed over, so calling
 * this repeatedly walks the backlog down and calling it once more at the end does nothing.
 */
export async function pushGlobalsEverywhere(limit = 25): Promise<PushResult> {
  const globals = await globalMergeVars();
  const out: PushResult = { processed: 0, updated: 0, failed: [], remaining: 0 };
  if (!Object.keys(globals).length) return out;

  for (const c of await listCampaigns()) {
    for (const contact of await listLeadsInCampaign(String(c.id))) {
      if (!needsUpdate(contact, globals)) continue;

      // Past the batch size: counted so the screen knows to come back, never written to.
      if (out.processed >= limit) { out.remaining++; continue; }

      const id = String((contact as { id?: string })?.id ?? '');
      const email = String((contact as { email?: string })?.email ?? '');
      if (!id) continue;

      out.processed++;
      try {
        const r = await updateLeadVariables(id, globals);
        if (r.ok && !r.mismatched.length) out.updated++;
        else out.failed.push({ email, fields: r.mismatched });
      } catch (e) {
        /**
         * One contact refusing is not a reason to abandon the other 756. It is recorded and
         * the run carries on — a partial success that names its failures is worth far more
         * than a stack trace and no idea how far it got.
         */
        out.failed.push({ email, fields: [e instanceof Error ? e.message : 'write failed'] });
      }
    }
  }
  return out;
}
