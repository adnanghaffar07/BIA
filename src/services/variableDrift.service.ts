import { globalMergeVars } from './globalMergeVars.service';
import { sql } from '@/lib/neon';
import { listCampaigns, listLeadsInCampaign, type VendorLead } from '@/lib/integrations/leadCampaign';
import { mergeVarsFor, customOnly, agencyWebsite } from './mergeVars.service';
import { mergeFieldByName } from '@/lib/mergeFields';

/**
 * What the platform holds for each contact, against what the CRM says today.
 *
 * ── Why a snapshot needs watching ───────────────────────────────────────────
 * custom_variables are written when a contact is CREATED and never again. Everything a
 * contact carries is therefore frozen at upload time, while the card behind it keeps moving:
 * a renewal date gets corrected, a lead gets rated, Frank finally supplies the band prices
 * that are empty on all 186 C1–C3 contacts right now.
 *
 * None of that reaches the platform on its own, and none of it fails loudly. A variable the
 * template asks for and the contact does not carry renders as NOTHING — no error, no bounce,
 * no row in any log. The email sends perfectly with a hole in it.
 *
 * ── What it found the first time it was pointed at production ───────────────
 * All 378 contacts in the C4–C7 campaign were uploaded before the 28 Sep rename and hold
 * the OLD names — renewalDate, streetAddress, subject1 — plus six spreadsheet column
 * headings ("City / ZIP", "Eff Date", "Renewal Week") from a hand-made CSV. Not one
 * snake_case name among them. Activating a campaign whose copy says {{renewal_date}} would
 * have sent 378 emails with every merged value blank.
 *
 * That is the whole argument for this file: nothing else in the system compares the two
 * sides, so nothing else could have said so.
 *
 * Reads only. It never writes to the platform and never writes to the CRM.
 */

export type DriftKind =
  /** The CRM has a value, the contact has none. The template renders blank. */
  | 'missing'
  /** Both have a value and they disagree. The template renders the OLD one. */
  | 'stale'
  /** The contact carries a name we do not produce. Harmless to a send, but it is evidence. */
  | 'orphan';

export type VariableDiff = {
  name: string;
  expected: string;
  actual: string;
  kind: DriftKind;
};

export type ContactDrift = {
  email: string;
  vendorLeadId: string;
  /** Null when the contact cannot be tied back to a card — see `unmatched` below. */
  propertyId: string | null;
  role: string | null;
  cohort: string | null;
  diffs: VariableDiff[];
};

export type DriftReport = {
  campaignId: string;
  campaignName: string;
  contacts: number;
  /** Contacts we could tie back to a CRM card, and therefore could check at all. */
  matched: number;
  /**
   * Contacts on the platform with no OutreachEvent row behind them.
   *
   * Not a rounding error: a contact with no row is one whose replies, bounces and
   * unsubscribes match against nothing and are silently dropped. Worth its own number.
   */
  unmatched: ContactDrift[];
  /**
   * Contacts with NOTHING at all to report — no drift and not even an inert orphan.
   *
   * Reported next to `correct`, never instead of it. After the 378 were repaired this was
   * still 0, because every contact keeps the old names beside the new ones, and a summary
   * built on it announced "0/378 carry what the CRM says" immediately after repairing all
   * 378 of them. The number was true and it said the opposite of what happened.
   */
  clean: number;
  /**
   * Contacts where every value a template will actually read is right.
   *
   * This is the one that answers "is this campaign safe to send" — orphans cannot be read
   * by anything, so they do not belong in the answer.
   */
  correct: number;
  drifted: ContactDrift[];
  byKind: Record<DriftKind, number>;
  /** Which variables are wrong, worst first — the actionable summary. */
  byVariable: Array<{ name: string; missing: number; stale: number; orphan: number }>;
  /**
   * Variables that agree because BOTH sides are empty, and are known to be blocked.
   *
   * Not drift — the platform holds exactly what the CRM holds — but it is the difference
   * between "correct" and "correct and useless". meeting_link matches on every contact and
   * renders nothing on every contact, and a report that called that clean would be telling
   * the truth in a way that misleads. There was a `pending` DriftKind for this at first; it
   * could never fire, because an empty value equals an empty value and the comparison had
   * already moved on.
   */
  waiting: Array<{ name: string; contacts: number; reason: string }>;
};

/**
 * Keys the platform owns or invents. Comparing them would report drift we neither caused
 * nor can fix: `campaign` is the platform's own id, and companyName/website/personalization
 * are built-ins we never set and which come back as empty strings on every contact.
 *
 * `email` is excluded because it is the contact's IDENTITY here, not a merge value — a
 * difference in it would mean we matched the wrong contact, which is checked separately.
 */
const PLATFORM_OWNED = new Set([
  'campaign', 'email', 'companyName', 'website', 'personalization',
]);

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** The variable map, wherever this vendor happens to put it on a given endpoint. */
function storedVars(lead: VendorLead): Record<string, unknown> {
  const l = lead as VendorLead & { custom_variables?: Record<string, unknown> };
  return l.payload ?? l.custom_variables ?? {};
}

/**
 * Compare one contact's stored variables against what the CRM would build for them today.
 *
 * Pure, and separated from the campaign walk above ON PURPOSE: this is the part that decides
 * whether 378 emails are about to go out with holes in them, and it should be testable
 * without a network call, a campaign, or a row in the database.
 *
 * `waiting` is the names that agree because both sides are empty AND are known to be blocked.
 * They are not drift and they are not clean either — the platform holds exactly what the CRM
 * holds, and what it holds is nothing.
 */
export function diffVariables(
  expected: Record<string, string>,
  actual: Record<string, unknown>,
): { diffs: VariableDiff[]; waiting: string[] } {
  const diffs: VariableDiff[] = [];
  const waiting: string[] = [];

  for (const [name, want] of Object.entries(expected)) {
    if (PLATFORM_OWNED.has(name)) continue;
    const have = str(actual[name]);
    if (have === want) {
      if (!want && mergeFieldByName(name)?.blocked) waiting.push(name);
      continue;
    }
    diffs.push({ name, expected: want, actual: have, kind: have ? 'stale' : 'missing' });
  }

  /**
   * Names the contact carries that we do not produce.
   *
   * They cannot break a send — no template references them — but they are the fingerprint
   * of a hand-made upload, and they are how the 28 Sep rename was caught: every one of the
   * 378 live contacts holds `renewalDate` as an orphan and is missing `renewal_date`, which
   * is the same fact told from both ends. Reporting only the missing half would have looked
   * like a data problem instead of a rename nobody re-uploaded for.
   */
  for (const name of Object.keys(actual)) {
    if (PLATFORM_OWNED.has(name)) continue;
    if (name in expected) continue;
    diffs.push({ name, expected: '', actual: str(actual[name]), kind: 'orphan' });
  }

  return { diffs, waiting };
}

export async function checkCampaignDrift(campaignId: string): Promise<DriftReport> {
  const campaigns = await listCampaigns();
  const campaign = campaigns.find((c) => c.id === campaignId);

  const vendorLeads = await listLeadsInCampaign(campaignId);
  const site = await agencyWebsite();
  const globals = await globalMergeVars();

  /**
   * Tie each contact back to a card.
   *
   * By vendorLeadId first, because it is the identity the platform itself assigned and
   * cannot be ambiguous. Falling back to the address, because 186 of the 564 rows were
   * registered from a CSV upload and never got an id — and those are exactly the contacts
   * most likely to be stale, so skipping them would blind the check to its own best case.
   */
  const rows = await sql`
    SELECT "leadId", "propertyId", "personRole", "recipientEmail", "vendorLeadId", "cohort"
      FROM "OutreachEvent"
     WHERE "vendorCampaignId" = ${campaignId} OR "vendorCampaignId" IS NULL` as Array<{
      leadId: string; propertyId: string | null; personRole: string;
      recipientEmail: string; vendorLeadId: string | null; cohort: string | null;
    }>;

  const byVendorId = new Map<string, typeof rows[number]>();
  const byEmail = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    if (r.vendorLeadId) byVendorId.set(r.vendorLeadId, r);
    const e = str(r.recipientEmail).toLowerCase();
    if (!e) continue;

    /**
     * A row belonging to THIS campaign always beats an unassigned one.
     *
     * The query deliberately pulls in rows with no campaign, because 186 are registered and
     * waiting to be uploaded and those are the ones most likely to be stale later. But that
     * puts two different cards in the same lookup, and three addresses are shared between a
     * C1–C3 property and a C4–C7 one. First-one-wins would have let an un-uploaded C1–C3 row
     * answer for a C4–C7 contact — reporting drift against the wrong house, and, if a
     * re-sync then acted on it, WRITING the wrong house's address onto a live contact.
     *
     * Nothing hit this yet only because every contact currently on the platform has a vendor
     * id and never reaches the fallback.
     */
    const existing = byEmail.get(e);
    if (!existing) { byEmail.set(e, r); continue; }
    const rIsOurs = r.vendorLeadId != null;
    const existingIsOurs = existing.vendorLeadId != null;
    if (rIsOurs && !existingIsOurs) byEmail.set(e, r);
  }

  const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))];
  const leads = leadIds.length
    ? await sql`SELECT * FROM "Lead" WHERE "id" = ANY(${leadIds})` as Array<Record<string, unknown>>
    : [];
  const leadById = new Map(leads.map((l) => [String(l.id), l]));

  const unmatched: ContactDrift[] = [];
  const drifted: ContactDrift[] = [];
  const byKind: Record<DriftKind, number> = { missing: 0, stale: 0, orphan: 0 };
  const perVar = new Map<string, { missing: number; stale: number; orphan: number }>();
  const waitingCount = new Map<string, number>();
  let matched = 0;
  let clean = 0;
  let correct = 0;

  for (const vl of vendorLeads) {
    const email = str(vl.email).toLowerCase();
    const link = (vl.id && byVendorId.get(vl.id)) || byEmail.get(email) || null;

    if (!link || !leadById.has(String(link.leadId))) {
      unmatched.push({
        email, vendorLeadId: vl.id, propertyId: null, role: null, cohort: null, diffs: [],
      });
      continue;
    }
    matched++;

    const lead = leadById.get(String(link.leadId))!;
    const role = link.personRole === 'insured' ? 'insured' : 'coInsured';
    const expected = customOnly(mergeVarsFor(lead, role, site, globals));

    // The built-ins are set through the API's own fields, so they are not in `expected` —
    // but the platform stores them in the same map, and a wrong first name is exactly the
    // bug that shipped "Hi ,". Checked explicitly rather than skipped.
    const expectedAll: Record<string, string> = {
      ...Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, str(v)])),
      firstName: str(role === 'insured' ? lead.owner1FirstName : lead.owner2FirstName),
      lastName: str(role === 'insured' ? lead.owner1LastName : lead.owner2LastName),
    };

    const { diffs, waiting } = diffVariables(expectedAll, storedVars(vl));
    for (const name of waiting) waitingCount.set(name, (waitingCount.get(name) ?? 0) + 1);

    for (const d of diffs) {
      byKind[d.kind]++;
      const p = perVar.get(d.name) ?? { missing: 0, stale: 0, orphan: 0 };
      p[d.kind]++;
      perVar.set(d.name, p);
    }

    // Counted before the early-out below, because a contact can be correct for sending and
    // still carry orphans — which is exactly the state 378 contacts are in after a repair.
    if (!diffs.some((d) => d.kind !== 'orphan')) correct++;

    if (diffs.length) drifted.push({
      email,
      vendorLeadId: vl.id,
      // From the CARD, falling back to the send-log row. The 378 pushed rows carry NULL in
      // both columns, so reading the row first printed every contact as "property ?" —
      // which makes the CSV unworkable for the person who has to go and fix them.
      propertyId: str(lead.propertyId) || link.propertyId || null,
      role,
      cohort: str(lead.cohort) || link.cohort || null,
      diffs,
    });
    else clean++;
  }

  const byVariable = [...perVar.entries()]
    .map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => (b.missing + b.stale + b.orphan) - (a.missing + a.stale + a.orphan) || a.name.localeCompare(b.name));

  return {
    campaignId,
    campaignName: campaign?.name ?? '(unknown campaign)',
    contacts: vendorLeads.length,
    matched,
    unmatched,
    clean,
    correct,
    drifted,
    byKind,
    byVariable,
    waiting: [...waitingCount.entries()]
      .map(([name, contacts]) => ({
        name,
        contacts,
        reason: mergeFieldByName(name)?.blocked ?? '',
      }))
      .sort((x, y) => y.contacts - x.contacts),
  };
}
