import { getCampaign, listLeadsInCampaign, updateLeadVariables } from '@/lib/integrations/leadCampaign';
import { sql } from '@/lib/neon';
import { mergeVarsFor, agencyWebsite, customOnly } from './mergeVars.service';
import { insuredEmails, coInsuredEmails } from './recipients.service';
import { globalMergeVars } from './globalMergeVars.service';
import { mergeFieldByName, tokensIn } from '@/lib/mergeFields';

/**
 * What the copy asks for, against what we actually send.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The email copy is written on the sending platform, by Zoya, and the values behind it are
 * built here. Nothing joined the two. A template can ask for {{roof_age}} forever: the
 * platform has no such variable, renders it as nothing, and sends a sentence with a hole in
 * it. No error, no warning, no bounce — the email looks fine on the way out and wrong on the
 * way in.
 *
 * That is not hypothetical. A test send arrived reading "Hi ," because the copy said
 * {{first_name}} while the platform's built-in is {{firstName}} — one character, invisible
 * everywhere, and the contact was holding the right value the whole time.
 *
 * So this reads the LIVE sequence off the platform, pulls every token out of every subject
 * and body, and says of each one: we send it, the platform fills it, we know it but it will
 * be empty for this lead, or nobody has ever heard of it.
 *
 * ── Judged against a real contact, not against the catalogue ────────────────
 * "band_low is a known field" and "band_low has a value on the account this campaign is
 * about to mail" are different statements, and only the second one predicts what lands in an
 * inbox. So a lead actually in the campaign is used to build the variables, and the answer is
 * about that lead. A catalogue check would have called the band fine on all 133 C1–C3 cards
 * while 129 of them had no band on them.
 */

export type TokenStatus =
  /** The platform fills this itself — firstName, lastName. */
  | 'built_in'
  /** We send it and it has a value. */
  | 'sent'
  /** We know the field, and it is empty for this lead. It will render as nothing. */
  | 'empty'
  /**
   * We would send it, and the contact standing in the campaign does not carry it.
   *
   * custom_variables are written when a contact is CREATED and never again, so a value set
   * after an upload never reaches the people already in the campaign. This is the state that
   * looks fine everywhere and still sends a blank — the CRM has the value, the copy asks for
   * it correctly, and the email arrives with a hole in it.
   */
  | 'stale'
  /** Nothing in the CRM produces this. It will always render as nothing. */
  | 'unknown';

export type CopyToken = {
  name: string;
  status: TokenStatus;
  /** Where in the sequence it appears, e.g. "Step 1 subject". */
  where: string[];
  /** What the lead below would actually receive. */
  value: string | null;
  /** Plain English, for somebody who did not write the copy. */
  note: string;
  /** How many contacts in the campaign do not carry it, when that is the problem. */
  missingOn?: number;
  ofContacts?: number;
};

export type CopyAudit = {
  campaignId: string;
  campaignName: string;
  steps: number;
  /** The contact the values were computed for, so the answer can be checked by hand. */
  sample: { leadId: string; email: string; owner: string | null; standIn: boolean } | null;
  /** How many contacts the campaign holds, so the screen can say what was checked. */
  contacts: number;
  tokens: CopyToken[];
  /** Fields we send that the copy never mentions — not a fault, but worth seeing. */
  unused: string[];
  /** Tokens that will arrive blank: the count that matters. */
  problems: number;
  /** Set when the sequence could not be read rather than when it is clean. */
  error?: string;
};

/**
 * Variables the sending platform fills itself.
 *
 * Two families. The contact ones — firstName, companyName — come from the uploaded lead.
 * The account ones describe whichever MAILBOX is sending, which is why they are the
 * platform's job and not ours: the answer changes per mailbox, not per homeowner, and we
 * would have to attach the right producer's details to every contact to reproduce it.
 *
 * Getting this list short is not the safe direction. A missing entry here reports a
 * perfectly good variable as broken — {{accountSignature}} was flagged as arriving blank on
 * live copy that the platform fills correctly — and a check that raises false alarms is one
 * people stop reading, which costs more than the check was ever worth.
 *
 * It is a hand-maintained list against somebody else's product, so it can go out of date in
 * both directions. If a variable here really does arrive empty, the answer is the platform's
 * account settings rather than the CRM.
 */
/**
 * Push today's values onto the contacts already standing in a campaign.
 *
 * ── Why it is needed at all ─────────────────────────────────────────────────
 * custom_variables are written when a contact is CREATED and never again. Set a value after
 * an upload and the people already in the campaign never receive it — the CRM has it, the
 * copy spells it right, and the email still arrives with a hole in it.
 *
 * ── Every write is read back ────────────────────────────────────────────────
 * The platform answers 200 to a PATCH that stored nothing, so its own response proves
 * nothing. updateLeadVariables re-reads each contact and reports what did not take, and this
 * counts those separately rather than folding them into the success number — "synced 40" that
 * quietly includes 6 failures is worse than no figure.
 */
export async function resyncCampaignVariables(campaignId: string): Promise<{
  contacts: number; updated: number; skipped: number;
  /** Given the shared values only, because no lead in the CRM matches that address. */
  sharedOnly: number;
  failed: Array<{ email: string; fields: string[] }>;
}> {
  const [contacts, site, globals] = await Promise.all([
    listLeadsInCampaign(campaignId), agencyWebsite(), globalMergeVars(),
  ]);

  /**
   * ── Finding the lead behind a contact ────────────────────────────────────
   *
   * This matched on email1 / email2 / owner2Email, and on a real campaign 52 of 53 contacts
   * "had no lead" — so the run reported "1 updated, 52 skipped" and looked broken.
   *
   * Every one of those addresses WAS in the CRM. They were in emailsAll and inside the trace
   * payload, which is where a skip-traced address lives until something copies it onto a
   * column. It is the same column-versus-payload mistake this project has removed from the
   * send list, the push and the reachability report, made once more here.
   *
   * So the columns are only a first pass. The map is built with insuredEmails() and
   * coInsuredEmails() — the functions that walk the payload and attribute each address to a
   * person — which is what every other part of the system means by "this lead's address".
   */
  const wanted = contacts
    .map((c) => String(c?.email ?? '').trim().toLowerCase())
    .filter(Boolean);

  const candidates = wanted.length
    ? await sql`
        SELECT * FROM "Lead"
         WHERE lower("email1") = ANY(${wanted}::text[])
            OR lower("email2") = ANY(${wanted}::text[])
            OR lower("owner2Email") = ANY(${wanted}::text[])
            OR "emailsAll" ?| ${wanted}::text[]` as Array<Record<string, any>>
    : [];

  const byEmail = new Map<string, Record<string, any>>();
  for (const l of candidates) {
    for (const e of [...insuredEmails(l), ...coInsuredEmails(l)]) {
      const k = String(e).trim().toLowerCase();
      if (k && !byEmail.has(k)) byEmail.set(k, l);
    }
    // The columns too, in case a producer typed an address the payload never saw.
    for (const e of [l.email1, l.email2, l.owner2Email]) {
      const k = String(e ?? '').trim().toLowerCase();
      if (k && !byEmail.has(k)) byEmail.set(k, l);
    }
  }
  const leadFor = (email: string) => byEmail.get(email) ?? null;
  const out = {
    contacts: contacts.length, updated: 0, skipped: 0, sharedOnly: 0,
    failed: [] as Array<{ email: string; fields: string[] }>,
  };

  for (const c of contacts) {
    const email = String(c?.email ?? '').trim().toLowerCase();
    if (!email || !c?.id) { out.skipped++; continue; }

    /**
     * The lead behind the contact. Without it there is no household to build variables from,
     * so the contact is left exactly as it is — writing a partial set would replace real
     * values with nothing.
     */
    const lead = leadFor(email);

    /**
     * No matching lead is not a reason to send nothing.
     *
     * This skipped the contact outright, throwing away the values that never needed a lead
     * in the first place — the shared ones are identical for everybody by definition. A test
     * address, or a contact uploaded from outside the CRM, came back as "0 of 1 updated,
     * 1 skipped" and read as a button that does not work.
     *
     * A PATCH MERGES custom_variables rather than replacing them, so sending the shared set
     * alone cannot wipe per-lead values a previous upload had put there.
     */
    const vars = lead
      ? customOnly(mergeVarsFor(
          lead,
          /**
           * Which person this contact is, by the same attribution the rest of the system
           * uses. An owner2Email column test misses a co-insured address that only exists
           * inside the trace payload — and getting this wrong sends the co-insured the
           * insured's name in the greeting.
           */
          coInsuredEmails(lead).some((e) => String(e).trim().toLowerCase() === email)
            ? 'coInsured' : 'insured',
          site, globals,
        ))
      : globals;

    if (!Object.keys(vars).length) { out.skipped++; continue; }

    const r = await updateLeadVariables(String(c.id), vars);
    if (!r.ok || r.mismatched.length) out.failed.push({ email, fields: r.mismatched });
    else if (lead) out.updated++;
    // Counted apart: this contact now has the shared values and none of the per-lead ones,
    // which is a different thing from being fully up to date and should not read as one.
    else out.sharedOnly++;
  }
  return out;
}

const BUILT_IN = new Set([
  // From the contact record on the platform.
  'firstName', 'lastName', 'companyName', 'website', 'phone', 'personalization', 'email',
  // From the sending mailbox.
  'accountSignature', 'sendingAccountFirstName', 'sendingAccountLastName',
  'sendingAccountEmail', 'emailAccount',
  // Inserted by the platform at send.
  'unsubscribeLink',
]);

/**
 * Details of the person SENDING, which belong to the mailbox rather than to the homeowner.
 *
 * A producer's name, licence, direct line, office and website change with whichever mailbox
 * sends, not with who receives. Attaching them to every contact would mean getting the right
 * producer's details onto each one — and getting it wrong the first time a different mailbox
 * picks the lead up, which is a licence number under the wrong name on a regulated email.
 *
 * They belong in the mailbox signature, which the platform inserts for itself.
 */
const SIGNATURE_FIELDS = new Set([
  'producer_name', 'license_number', 'producer_direct_phone', 'office_address',
  'agency_website', 'producer_email', 'agency_name',
]);

/**
 * The specific advice, where the copy makes it obvious.
 *
 * When a passage already carries {{accountSignature}}, the signature is going in anyway and
 * these tokens are a second, empty copy of what it holds. Saying "nothing produces this" is
 * true and useless; the useful sentence is "delete it, the signature already says that".
 */
function signatureAdvice(name: string, usesAccountSignature: boolean): string | null {
  if (!SIGNATURE_FIELDS.has(name)) return null;
  return usesAccountSignature
    ? 'This copy already inserts the mailbox signature with {{accountSignature}}, which carries '
      + 'this. Delete this one from the body — it will only ever print an empty space next to '
      + 'the signature that already says it.'
    : 'This describes the producer sending the email, not the homeowner receiving it, so it '
      + 'changes per mailbox rather than per contact. Use {{accountSignature}} to insert the '
      + 'whole signature instead.';
}

/**
 * The name they almost certainly meant.
 *
 * Every unknown token found on the live copy so far has been a spelling of something that
 * does exist: cta1 for cta_1, first_name for firstName. Both differ only in underscores and
 * capitals, both print nothing, and both are invisible in an editor — the test send that
 * arrived reading "Hi ," was this exact mistake, and it took a person reading the email to
 * notice.
 *
 * Matched on letters and digits alone, so case and underscores stop mattering. Deliberately
 * nothing cleverer: an edit-distance guess would start proposing town for month, and a
 * confident wrong suggestion in a checker is worse than none.
 */
function nearMiss(name: string, available: string[]): string | null {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = flat(name);
  const hit = [...available, ...BUILT_IN].find((c) => c !== name && flat(c) === target);
  return hit
    ? `Did you mean {{${hit}}}? That one exists and has a value — this spelling does not, and `
      + 'prints nothing.'
    : null;
}

/**
 * Audit one campaign's live copy.
 *
 * Read-only on both sides: it fetches the sequence and one contact, and writes nothing
 * anywhere. Running it on a live campaign is safe.
 */
export async function auditCampaignCopy(campaignId: string): Promise<CopyAudit> {
  const campaign = await getCampaign(campaignId);
  const base: CopyAudit = {
    campaignId,
    campaignName: campaign?.name ?? campaignId,
    steps: 0,
    sample: null,
    contacts: 0,
    tokens: [],
    unused: [],
    problems: 0,
  };

  /**
   * Every subject and body in the sequence, each labelled with where it came from.
   *
   * Variants are kept apart. A/B variants of one step are different copy and can ask for
   * different things, so collapsing them would hide a token that only one of them uses —
   * and that variant still sends to half the cohort.
   */
  const passages: Array<{ where: string; text: string }> = [];
  const steps = campaign?.sequences?.[0]?.steps ?? [];
  steps.forEach((step, i) => {
    (step?.variants ?? []).forEach((v, vi) => {
      const label = `Step ${i + 1}${(step?.variants?.length ?? 0) > 1 ? ` variant ${String.fromCharCode(65 + vi)}` : ''}`;
      if (v?.subject) passages.push({ where: `${label} subject`, text: String(v.subject) });
      if (v?.body) passages.push({ where: `${label} body`, text: String(v.body) });
    });
  });
  base.steps = steps.length;

  if (!passages.length) {
    return { ...base, error: 'This campaign has no sequence copy on the platform yet.' };
  }

  /**
   * A real contact from this campaign, and the lead behind it.
   *
   * Falls back to any lead in the CRM if the campaign has no contacts yet, so the copy can
   * still be checked before anybody is uploaded — the answer is then about a representative
   * account rather than a targeted one, which is stated on the screen.
   */
  let lead: Record<string, any> | null = null;
  let sampleEmail: string | null = null;
  /**
   * EVERY contact in the campaign, and what each one actually carries.
   *
   * This read the first contact only and reported its answer as the campaign's. On Test
   * Campaign V0 the first contact carried office_address and the second did not, so the check
   * said "Filled in" while the email that actually went out was blank. One contact cannot
   * speak for the rest: they are uploaded at different times and a value set in between
   * reaches only the ones created after it.
   *
   * Empty when no contact could be read — the audit then says what we would send and does not
   * claim to have checked anything.
   */
  let contactVars: Array<{ email: string; held: Record<string, unknown> }> = [];
  /** True when the lead below is a stand-in rather than somebody actually in the campaign. */
  let leadIsStandIn = false;
  try {
    const contacts = await listLeadsInCampaign(campaignId);
    contactVars = contacts
      .filter((c) => c?.email)
      .map((c) => {
        const withVars = c as typeof c & { custom_variables?: Record<string, unknown> };
        return {
          email: String(c.email),
          held: (withVars.payload ?? withVars.custom_variables ?? {}) as Record<string, unknown>,
        };
      });

    /**
     * The lead used for the per-lead VALUES is the first contact that is actually a lead.
     *
     * Not simply the first contact: a test address has no lead behind it, and taking it would
     * leave every per-lead value unknown on a campaign full of real households.
     */
    /**
     * Matched the same way the re-sync matches, and for the same reason.
     *
     * A column-only lookup found 1 lead in a campaign of 53 — every other address was in
     * emailsAll or inside the trace payload. Here that meant the audit fell back to a
     * stand-in lead and described a household not in the send; in the re-sync it meant 52
     * contacts reported as "nothing to send". One rule, so the check and the fix cannot
     * disagree about who a contact is.
     */
    const wanted = contactVars.map((c) => c.email.toLowerCase());
    const candidates = wanted.length
      ? await sql`
          SELECT * FROM "Lead"
           WHERE lower("email1") = ANY(${wanted}::text[])
              OR lower("email2") = ANY(${wanted}::text[])
              OR lower("owner2Email") = ANY(${wanted}::text[])
              OR "emailsAll" ?| ${wanted}::text[]` as Array<Record<string, any>>
      : [];
    const byEmail = new Map<string, Record<string, any>>();
    for (const l of candidates) {
      for (const e of [...insuredEmails(l), ...coInsuredEmails(l), l.email1, l.email2, l.owner2Email]) {
        const k = String(e ?? '').trim().toLowerCase();
        if (k && !byEmail.has(k)) byEmail.set(k, l);
      }
    }
    for (const c of contactVars) {
      const hit = byEmail.get(c.email.toLowerCase());
      if (hit) { lead = hit; sampleEmail = c.email; break; }
    }
  } catch { /* the audit is still worth running without a contact */ }

  if (!lead) {
    /**
     * Nobody in the campaign is a lead — a campaign of test addresses, or one not yet
     * uploaded. A representative account is used so the per-lead values can still be shown,
     * and leadIsStandIn says so, because labelling it "a real contact in this campaign" when
     * it is not is how somebody trusts a value for a household that is not in the send.
     */
    const rows = await sql`
      SELECT * FROM "Lead"
       WHERE COALESCE("manualGrade","grade") = 'A' AND "email1" IS NOT NULL
       ORDER BY "effectiveDate" LIMIT 1` as Array<Record<string, any>>;
    lead = rows[0] ?? null;
    leadIsStandIn = !!lead;
  }

  base.contacts = contactVars.length;
  /**
   * Loaded separately as well as passed into mergeVarsFor, because the comparison below has
   * to know WHICH variables are the same for everybody. Only those can be compared against a
   * contact by value; a per-lead one differs per household by design.
   */
  const globals = await globalMergeVars();
  const vars = lead ? mergeVarsFor(lead, 'insured', await agencyWebsite(), globals) : {};
  if (lead) {
    base.sample = {
      leadId: String(lead.id),
      email: sampleEmail ?? String(lead.email1 ?? ''),
      owner: [lead.owner1FirstName, lead.owner1LastName].filter(Boolean).join(' ') || null,
      standIn: leadIsStandIn,
    };
  }

  /** Every token the copy uses, with everywhere it appears. */
  const seen = new Map<string, string[]>();
  for (const p of passages) {
    for (const name of tokensIn(p.text)) {
      if (!seen.has(name)) seen.set(name, []);
      const at = seen.get(name)!;
      if (!at.includes(p.where)) at.push(p.where);
    }
  }

  const tokens: CopyToken[] = [];
  for (const [name, where] of seen) {
    if (BUILT_IN.has(name)) {
      tokens.push({
        name, where, value: null, status: 'built_in',
        note: 'The sending platform fills this one in itself.',
      });
      continue;
    }

    const known = mergeFieldByName(name);
    const raw = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
    const value = raw == null || raw === '' ? null : String(raw);

    if (!known && raw === undefined) {
      tokens.push({
        name, where, value: null, status: 'unknown',
        note: signatureAdvice(name, seen.has('accountSignature'))
          ?? nearMiss(name, Object.keys(vars))
          ?? 'Nothing in the CRM produces this. It will arrive blank in every email.',
      });
      continue;
    }
    if (value === null) {
      tokens.push({
        name, where, value: null, status: 'empty',
        note: known?.blocked
          ? known.blocked
          : 'We know this field, but there is no value on this account. It will arrive blank.',
      });
      continue;
    }
    /**
     * We would send it — but does the contact already standing in the campaign carry it?
     *
     * custom_variables are written when a contact is created and never again, so a value set
     * or changed after the upload never reaches the people already in it. That is the state
     * that looks correct on every screen and still sends a blank: the CRM has the value, the
     * copy spells the name right, and the email arrives with a hole in it.
     *
     * Only asserted when the contact was actually readable. Not knowing is not the same as
     * knowing it is missing, and a checker that guesses in that gap earns the same distrust
     * as one that cries wolf.
     */
    /**
     * Absent OR different. Testing only for absence was not enough.
     *
     * A contact carrying an OLD value passes a presence check and reads as correct, while the
     * email goes out with the superseded string in it. That is worse than a blank: a blank is
     * visibly wrong and somebody fixes it, where a stale address is a plausible sentence
     * nobody questions. It happened on the first real test — the CRM was corrected and the
     * contact went on sending the previous address.
     *
     * Only compared for variables whose value is the same for everybody. A per-lead value
     * legitimately differs from this sample lead's on every other contact, so comparing it
     * would report the whole campaign as wrong on every run.
     */
    const isShared = Object.prototype.hasOwnProperty.call(globals, name);
    const behind = contactVars.filter((c) => {
      const has = Object.prototype.hasOwnProperty.call(c.held, name);
      if (!has) return true;
      return isShared && String(c.held[name] ?? '') !== String(value ?? '');
    });

    if (contactVars.length && behind.length) {
      const absent = behind.filter((c) => !Object.prototype.hasOwnProperty.call(c.held, name)).length;
      const differs = behind.length - absent;
      tokens.push({
        name, where, value, status: 'stale',
        missingOn: behind.length,
        ofContacts: contactVars.length,
        note: `The CRM has this (${value}), but `
          + (behind.length === contactVars.length
            ? `none of the ${contactVars.length} contact(s) in this campaign are up to date`
            : `${behind.length} of the ${contactVars.length} contacts are behind `
              + `(${behind.slice(0, 2).map((c) => c.email).join(', ')}${behind.length > 2 ? '…' : ''})`)
          + (differs
            ? ` — ${differs} still carry an older value, so the email sends that instead.`
            : ' — they were uploaded before it was set, so it sends blank to them.')
          + ' Update the contacts below.',
      });
      continue;
    }

    tokens.push({
      name, where, value, status: 'sent',
      note: 'Sent with the contact and filled in on send.',
    });
  }

  tokens.sort((a, b) => {
    const rank = { unknown: 0, stale: 1, empty: 2, sent: 3, built_in: 4 } as const;
    return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
  });

  /**
   * What we send that the copy never asks for.
   *
   * Harmless — an unused variable costs nothing — but it is the other half of the same
   * question, and it is how somebody notices that the copy says {{renewal_month}} while we
   * send {{month}}.
   */
  const used = new Set(seen.keys());
  base.unused = Object.keys(vars)
    .filter((k) => !used.has(k) && !BUILT_IN.has(k))
    .sort();

  base.tokens = tokens;
  // A stale one is a blank in an inbox exactly like the other two, so it counts.
  base.problems = tokens.filter(
    (t) => t.status === 'unknown' || t.status === 'empty' || t.status === 'stale',
  ).length;
  return base;
}
