import { listCampaigns, getCampaign, listLeadsInCampaign, CAMPAIGN_STATUS } from '@/lib/integrations/leadCampaign';
import { auditCampaignCopy } from './campaignCopy.service';
import { getSignature } from './mailboxSignature.service';

/**
 * Can this campaign actually send, and if not, what is stopping it?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Nothing has gone to a homeowner yet, and the reason is never one thing. On 30 Sep every
 * campaign was short of a sending mailbox, most were short of a signature, all eight had
 * seven variables that would arrive blank, and two of those needed a value nobody had set.
 * Each of those facts lived on a different screen, so "why hasn't this gone out" could only
 * be answered by someone who knew all five places to look — and answered differently
 * depending on which one they checked first.
 *
 * ── Every gate is derived and names its own fix ─────────────────────────────
 * Nothing here is a checkbox somebody ticks. A gate passes because the thing it describes is
 * true, and it says where to go and fix it when it is not. A readiness screen that can be
 * marked ready by hand is a screen that eventually says ready about a campaign that is not.
 *
 * ── Blocking versus worth knowing ───────────────────────────────────────────
 * A campaign with no mailbox cannot physically send; copy with a blank variable sends
 * perfectly and arrives wrong. Both matter and only one is a hard stop, so they are not
 * flattened into one colour — "ready" here means it can send AND what it sends is right.
 */

export type GateSeverity = 'blocker' | 'warning';

export type Gate = {
  key: string;
  label: string;
  ok: boolean;
  severity: GateSeverity;
  /** What is wrong, in a sentence somebody can act on without asking. */
  detail: string;
  /** Where the fix is made. */
  fixAt: string;
};

export type CampaignReadiness = {
  id: string;
  name: string;
  status: string;
  contacts: number;
  gates: Gate[];
  blockers: number;
  warnings: number;
  ready: boolean;
};

export async function campaignReadiness(): Promise<CampaignReadiness[]> {
  const campaigns = await listCampaigns();

  /**
   * Signatures read once, not once per campaign.
   *
   * A mailbox usually serves several campaigns, and each read is a separate API call against
   * somebody else's rate limit — the naive version made 28 of them per campaign and timed
   * out before the page rendered.
   */
  const sigCache = new Map<string, { ok: boolean; problems: string[] }>();
  const signatureOf = async (email: string) => {
    const hit = sigCache.get(email);
    if (hit) return hit;
    try {
      const s = await getSignature(email);
      const v = { ok: s.problems.length === 0, problems: s.problems };
      sigCache.set(email, v);
      return v;
    } catch {
      const v = { ok: false, problems: ['could not be read from the platform'] };
      sigCache.set(email, v);
      return v;
    }
  };

  const out: CampaignReadiness[] = [];

  for (const c of campaigns) {
    const id = String(c.id);
    const detail = await getCampaign(id).catch(() => null);
    const contacts = await listLeadsInCampaign(id).catch(() => []);
    const mailboxes: string[] = (detail as Record<string, any>)?.email_list ?? [];
    const steps = detail?.sequences?.[0]?.steps ?? [];
    const gates: Gate[] = [];

    // ── Can it physically send ───────────────────────────────────────────
    gates.push({
      key: 'contacts',
      label: 'Has contacts',
      ok: contacts.length > 0,
      severity: 'blocker',
      detail: contacts.length
        ? `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`
        : 'No contacts have been uploaded, so there is nobody to send to.',
      fixAt: 'Push from the CRM, or upload on the platform',
    });

    gates.push({
      key: 'mailbox',
      label: 'Sending mailbox assigned',
      ok: mailboxes.length > 0,
      severity: 'blocker',
      detail: mailboxes.length
        ? mailboxes.join(', ')
        : 'No mailbox is assigned, so this campaign cannot send at all. Choosing one also '
          + 'chooses whose name and licence number appear on the email.',
      fixAt: 'Sending mailboxes tab',
    });

    const hasCopy = steps.some((s) => (s?.variants ?? []).some((v) => v?.subject && v?.body));
    gates.push({
      key: 'copy',
      label: 'Email copy written',
      ok: hasCopy,
      severity: 'blocker',
      detail: hasCopy
        ? `${steps.length} email${steps.length === 1 ? '' : 's'} in the sequence`
        : 'No step has both a subject and a body.',
      fixAt: 'Email sequence tab',
    });

    // ── Signatures on whichever mailboxes will send ──────────────────────
    if (mailboxes.length) {
      const checked = await Promise.all(mailboxes.map(async (m) => ({ m, ...(await signatureOf(m)) })));
      const bad = checked.filter((x) => !x.ok);
      gates.push({
        key: 'signature',
        label: 'Signatures compliant',
        ok: bad.length === 0,
        severity: 'blocker',
        detail: bad.length === 0
          ? 'Every sending mailbox has a compliant signature.'
          : `${bad.length} of ${checked.length} would send without one: `
            + bad.slice(0, 2).map((x) => `${x.m} (${x.problems[0]})`).join('; '),
        fixAt: 'Sending mailboxes → the mailbox → Signature',
      });
    }

    // ── Will what it sends be right ──────────────────────────────────────
    if (hasCopy) {
      const copy = await auditCampaignCopy(id).catch(() => null);
      const blanks = copy?.tokens.filter((t) => t.status === 'unknown' || t.status === 'empty') ?? [];
      const stale = copy?.tokens.filter((t) => t.status === 'stale') ?? [];

      gates.push({
        key: 'variables',
        label: 'Every variable has a value',
        ok: blanks.length === 0,
        severity: 'warning',
        detail: blanks.length === 0
          ? 'Nothing in the copy will arrive blank.'
          : `${blanks.length} would arrive blank: ${blanks.slice(0, 4).map((t) => `{{${t.name}}}`).join(', ')}`
            + `${blanks.length > 4 ? '…' : ''}`,
        fixAt: 'Email sequence tab — the variables panel names each one',
      });

      gates.push({
        key: 'contactValues',
        label: 'Contacts carry current values',
        ok: stale.length === 0,
        severity: 'warning',
        detail: stale.length === 0
          ? 'Every contact has the values the copy asks for.'
          : `${stale.length} variable${stale.length === 1 ? ' is' : 's are'} set in the CRM but `
            + 'not on the contacts, so they would send blank.',
        fixAt: 'Email sequence tab → Update the contacts with today’s values',
      });
    }

    /**
     * The unsubscribe header. §5 treats it and the signature opt-out line as separate
     * requirements — neither substitutes for the other — so it is its own gate rather than
     * folded into the signature one.
     */
    const unsub = (detail as Record<string, any>)?.insert_unsubscribe_header;
    gates.push({
      key: 'unsubscribe',
      label: 'Unsubscribe header on',
      ok: unsub === true,
      severity: 'blocker',
      detail: unsub === true
        ? 'The platform will add the header.'
        : 'Off. §5 requires it, and it does not substitute for the opt-out line in the '
          + 'signature — both are needed.',
      fixAt: 'Settings tab',
    });

    const blockers = gates.filter((g) => !g.ok && g.severity === 'blocker').length;
    const warnings = gates.filter((g) => !g.ok && g.severity === 'warning').length;
    out.push({
      id,
      name: c.name,
      status: CAMPAIGN_STATUS[c.status] ?? String(c.status),
      contacts: contacts.length,
      gates,
      blockers,
      warnings,
      ready: blockers === 0 && warnings === 0,
    });
  }

  return out;
}
