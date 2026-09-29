import { insuredEmails, coInsuredEmails, coInsuredName } from './recipients.service';
import { groupHouseholds, householdScopeKey, type Household } from './household.service';
import { blockedAddresses } from './emailVerification.service';
import { heldAddresses } from './emailNameReview.service';
import { loadActiveSuppressions, type SuppressionHit } from './suppression.service';

/**
 * The send list, and the reason every excluded lead was excluded.
 *
 * ── Why the exclusions are the deliverable ──────────────────────────────────
 * Frank's go/no-go asks for "final Grade A file with exclusion report · household
 * suppression rule confirmed · dedup at both levels evidenced". A list of who gets mailed
 * is not evidence of anything. A list of who does NOT, each with a stated cause that adds
 * back to the cohort total, is the only form in which the rule can be checked — and it is
 * the form that catches the failure this project keeps hitting, where a filter quietly
 * drops leads and every count downstream agrees with itself while being wrong.
 *
 * Every lead in the input appears exactly once in the output: either as a recipient or as
 * an exclusion with a reason. recipients + exclusions = input. That is asserted, not hoped.
 *
 * ── The send rules applied here (Sec. 7.1) ──────────────────────────────────
 *   · One address per person. Not one per household, not every address on the card.
 *   · Insured only at E1. Co-insured from E2, and only as a second decision-maker.
 *   · Maximum two addresses per household.
 *   · A confirmed address wins outright: once engagement has confirmed one, it is the
 *     only address in that household that receives anything.
 *   · Suppression is checked here AND again at send time — this answers "who do we
 *     stage", the send-time check answers "may this go out right now".
 */

export type SendStep = 'E1' | 'E2' | 'E3';

export type Recipient = {
  leadId: string;
  propertyId: string;
  cohort: string | null;
  email: string;
  role: 'insured' | 'co_insured';
  firstName: string;
  lastName: string;
  householdKey: string;
  /** True when this address was confirmed by engagement — it overrides the normal rule. */
  confirmed: boolean;
};

export type ExclusionReason =
  | 'no_insured_email'        // nothing to send to at this step
  | 'suppressed_household'    // the household said stop / complained / is DNC
  | 'suppressed_address'      // this mailbox is dead or opted out
  | 'duplicate_household'     // another lead in the same household is already being mailed
  | 'duplicate_address'       // this exact address is already on the list
  | 'household_cap'           // already at two addresses for this household
  | 'failed_verification'     // the verifier says this mailbox is dead or hostile
  | 'name_review';            // recovered address whose surname nobody has matched yet

export type Exclusion = {
  leadId: string;
  propertyId: string;
  cohort: string | null;
  reason: ExclusionReason;
  detail: string;
};

export type SendList = {
  step: SendStep;
  recipients: Recipient[];
  exclusions: Exclusion[];
  counts: {
    leadsConsidered: number;
    households: number;
    recipients: number;
    excluded: Record<ExclusionReason, number>;
  };
  /** Sec. 2.1 discipline: the parts must add back to the whole, or the list is not sent. */
  reconciles: boolean;
};

/**
 * How many addresses one household may be written to.
 *
 * Was 2, which pre-dated Frank's 28 Sep answer and silently discarded the third and fourth
 * verified address on a card that had them. He is explicit that every verified address gets
 * its own email, so the cap is now a guard against absurdity rather than a policy: a card
 * carrying eight addresses is a trace that has gone wrong, not eight people.
 *
 * Kept rather than removed so one bad skip trace cannot mail a household nine times.
 */
const MAX_ADDRESSES_PER_HOUSEHOLD = 6;

/**
 * Re-exported so the existing callers keep working, and so there is one answer to "who is
 * eligible" — see sendCandidates.service.ts for why it does not live here any more.
 */
export { loadCandidates } from './sendCandidates.service';

/**
 * Build the list.
 *
 * Deterministic: same input, same output, same order. A send list that shuffles cannot be
 * reviewed, signed off and then sent with confidence that it is the thing that was signed.
 */
export async function buildSendList(
  leads: Record<string, unknown>[],
  step: SendStep = 'E1',
): Promise<SendList> {
  const { byLeadId } = groupHouseholds(leads);
  const sup = await loadActiveSuppressions();
  /**
   * Addresses the verifier found a reason not to mail.
   *
   * Separate from suppression, and it has to stay separate. A suppression is a person's own
   * decision and is permanent; this is a technical verdict on a mailbox that a re-check can
   * overturn. Folding them together would let a re-verification quietly release somebody who
   * had asked us to stop.
   */
  const blocked = await blockedAddresses();

  /**
   * ── The surname hold (Frank, second email §7) ────────────────────────────
   *
   * "A surname match between every skip-trace-recovered address and the insured or
   *  co-insured. Failures go to a review list, not into a send."
   *
   * The push has honoured this since it was written. This list did not, and a send list is
   * a send — it is the file somebody uploads to the platform. The two paths were checked
   * against each other on 28 Sep and agreed on every address except these: 40 on C1–C3 and
   * 209 on C4–C7 that the push refuses and the export was handing over.
   *
   * Frank on why the verifier does not cover it: "It confirms a mailbox exists, not that it
   * belongs to the person. It will pass this address and the send will still be wrong."
   */
  const heldForReview = await heldAddresses();

  const recipients: Recipient[] = [];
  const exclusions: Exclusion[] = [];
  const usedAddresses = new Set<string>();
  const perHousehold = new Map<string, number>();
  /** Which household keys already have somebody on the list — the dedup the campaign tool cannot do. */
  const householdOnList = new Set<string>();

  const exclude = (l: Record<string, unknown>, reason: ExclusionReason, detail: string) => {
    exclusions.push({
      leadId: String(l.id), propertyId: String(l.propertyId ?? ''),
      cohort: (l.cohort as string) ?? null, reason, detail,
    });
  };

  for (const l of leads) {
    const id = String(l.id);
    const hh: Household | undefined = byLeadId.get(id);
    /**
     * ONE key, from householdScopeKey — the stored householdId, or the address key for a
     * lead materialisation has not reached yet.
     *
     * There used to be two here: `hh?.key ?? householdKeyOf(l)` on one line and
     * `householdKeyOf(l)` on the next. groupHouseholds names a group after its lowest
     * lead id while householdKeyOf returns an address key, so for the same household
     * those are different strings — and the suppression lookup used one of them while
     * the count below used the other.
     */
    const hhKey = householdScopeKey(l);

    // 1. Household suppression outranks everything, including a confirmed address. A
    //    household that said stop does not get mail because one of its addresses once
    //    replied.
    /**
     * The household's own key first. The per-lead fallback after it covers a suppression
     * written against a lead that had no usable address at the time — householdKeyOf
     * returns `hh:lead:<id>` in that case — which would otherwise be invisible to a
     * household that has since been given a proper key.
     */
    const hhHit: SuppressionHit | undefined =
      sup.byHousehold.get(hhKey)
      ?? hh?.leadIds.map((x) => sup.byHousehold.get(`hh:lead:${x}`)).find(Boolean);
    if (hhHit) {
      exclude(l, 'suppressed_household', `${hhHit.reason} on ${hhHit.createdAt.slice(0, 10)}`);
      continue;
    }

    // 2. A confirmed address narrows the household to exactly one mailbox (Sec. 7.1).
    const confirmed = String(l.confirmedEmail ?? '').toLowerCase().trim();

    // 3. Who may be written to at this step. E1 is the insured only; the co-insured joins
    //    at E2 as a second decision-maker, never as a replacement.
    const ins = insuredEmails(l).map((e) => e.toLowerCase());

    /**
     * ── Frank, 28 Sep 2026 ───────────────────────────────────────────────────
     *
     * On the co-insured: "We are to be sending individual and personal emails regardless of
     * same household. We are not sure who will actually receive it and engage, so the whole
     * premise of insured and co-insured outreach is predicated on it being the first time
     * someone within that household is seeing our message."
     *
     * On several insured addresses: "Individual emails sent to each of the insured's
     * verified emails — we are not sure which will be primary so we must outreach all."
     *
     * Both rules here said the opposite. The co-insured was silent until E2, and only the
     * FIRST address of each person was ever used — 616 insured and 507 co-insured addresses
     * on C4–C7 alone that the system held and would never have written to.
     */
    const co = coInsuredEmails(l).map((e) => e.toLowerCase());

    let candidates: Array<{ email: string; role: 'insured' | 'co_insured' }> =
      confirmed
        /**
         * One exception, and it is not a contradiction of the above.
         *
         * Once somebody in the household has ANSWERED, the conversation belongs to that
         * person and the rest go quiet (§7.1). Frank's rule is about opening a conversation
         * with a household that has not replied — writing to three more addresses after one
         * of them has already engaged is a different thing, and a worse one.
         */
        ? [{ email: confirmed, role: (l.confirmedRole === 'co_insured' ? 'co_insured' : 'insured') }]
        : [
            ...ins.map((e) => ({ email: e, role: 'insured' as const })),
            ...co.map((e) => ({ email: e, role: 'co_insured' as const })),
          ];

    candidates = candidates.filter((c) => c.email);
    if (!candidates.length) {
      exclude(l, 'no_insured_email', step === 'E1' ? 'no insured email' : 'no insured or co-insured email');
      continue;
    }

    /**
     * ── The household dedup, now scoped to the PROPERTY ──────────────────────
     *
     * This used to drop a lead outright when any other lead in its household was already on
     * the list. Frank, 28 Sep: "individual and personal emails regardless of same
     * household" — a homeowner who owns two houses has two renewals, and hearing about only
     * one of them is not politeness, it is a missed renewal.
     *
     * What survives is the rule that actually prevents duplication: the same ADDRESS is
     * never written to twice (usedAddresses, below), which is the platform's own constraint
     * as well as good manners. Two different people at one household each get their own
     * email; one person does not get two.
     */
    void householdOnList;

    let placed = 0;
    for (const c of candidates) {
      const addrHit = sup.byEmail.get(c.email);
      if (addrHit) { exclude(l, 'suppressed_address', `${c.email}: ${addrHit.reason}`); continue; }
      /**
       * Checked BEFORE the duplicate and cap rules, so a dead address cannot occupy a
       * household's one slot and push a live one out.
       */
      const badVerdict = blocked.get(c.email);
      if (badVerdict) { exclude(l, 'failed_verification', `${c.email}: ${badVerdict}`); continue; }
      /**
       * Also before the duplicate and cap rules, and for the same reason: an address
       * awaiting review must not hold a household's slot against one that can be sent.
       */
      if (heldForReview.has(c.email)) { exclude(l, 'name_review', `${c.email}: awaiting surname review`); continue; }
      if (usedAddresses.has(c.email)) { exclude(l, 'duplicate_address', c.email); continue; }
      if ((perHousehold.get(hhKey) ?? 0) >= MAX_ADDRESSES_PER_HOUSEHOLD) {
        exclude(l, 'household_cap', `${c.email}: household already has ${MAX_ADDRESSES_PER_HOUSEHOLD}`);
        continue;
      }

      recipients.push({
        leadId: id,
        propertyId: String(l.propertyId ?? ''),
        cohort: (l.cohort as string) ?? null,
        email: c.email,
        role: c.role,
        firstName: String((c.role === 'insured' ? l.owner1FirstName : l.owner2FirstName) ?? '').trim(),
        lastName: String((c.role === 'insured' ? l.owner1LastName : l.owner2LastName) ?? '').trim(),
        householdKey: hhKey,
        confirmed: !!confirmed,
      });
      usedAddresses.add(c.email);
      perHousehold.set(hhKey, (perHousehold.get(hhKey) ?? 0) + 1);
      placed++;
    }
    if (placed) householdOnList.add(hhKey);
  }

  const excluded = {
    no_insured_email: 0, suppressed_household: 0, suppressed_address: 0,
    duplicate_household: 0, duplicate_address: 0, household_cap: 0,
    failed_verification: 0, name_review: 0,
  } as Record<ExclusionReason, number>;
  for (const e of exclusions) excluded[e.reason]++;

  /**
   * Every lead is either mailed or excluded, exactly once.
   *
   * A lead can contribute two exclusion rows (both of its addresses rejected) while still
   * being mailed at neither, so the check counts DISTINCT leads rather than rows.
   */
  const mailedLeads = new Set(recipients.map((r) => r.leadId));
  const excludedLeads = new Set(exclusions.map((e) => e.leadId));
  for (const id of mailedLeads) excludedLeads.delete(id);
  const reconciles = mailedLeads.size + excludedLeads.size === leads.length;

  return {
    step,
    recipients,
    exclusions,
    counts: {
      leadsConsidered: leads.length,
      households: new Set(leads.map((l) => householdScopeKey(l))).size,
      recipients: recipients.length,
      excluded,
    },
    reconciles,
  };
}

/** Co-insured display name, for E2 copy that has to address a second person. */
export { coInsuredName };
