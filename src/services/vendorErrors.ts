/**
 * Telling "this account is out of credits" apart from "this lead is unusable".
 *
 * ── Why this is a shared classifier and not an if-statement in the loop ─────
 * A blast that stops on the first error protects the account but punishes the cohort: one
 * lead with no insured name on file would end a 100-lead run. A blast that never stops
 * does the opposite — when the Tracerfy account ran dry it carried on and made ~290 calls
 * that could not succeed. Both failures come from treating every error the same, so the
 * difference has to be decided once, in one place, on the vendor's own response.
 *
 * ── Why the balance is not checked up front ────────────────────────────────
 * Neither vendor exposes a balance endpoint. Anything shown before a run is arithmetic on
 * a figure somebody typed in, and that figure goes stale the moment the account is topped
 * up outside the CRM — which is exactly how the QC screen came to insist there were zero
 * credits while the dashboard showed a balance. The vendor's refusal is the only account
 * fact we actually have, so the run learns it the way it really happens: it tries, gets
 * told no, and stops there.
 *
 * ── Why the match is deliberately loose ────────────────────────────────────
 * The exact body Tracerfy returns on an exhausted account has not been observed here — it
 * cannot be, without emptying the account. So this matches the shapes vendors use for it
 * (402, 429 with a credit/quota message, or any wording about credits, balance, funds or
 * quota) rather than one documented string. A false positive stops a run early and says
 * why, which is recoverable in a click. A false negative resumes billing into a dead
 * account, which is not. The raw vendor text is always carried through so the operator
 * sees what was actually said instead of our guess at it.
 */

export type VendorFault = 'no_credits' | 'auth' | 'vendor_error';

export class VendorError extends Error {
  readonly vendor: string;
  readonly fault: VendorFault;
  /** Verbatim vendor text, so the screen can show their words rather than ours. */
  readonly detail: string;
  readonly status: number | null;

  constructor(vendor: string, fault: VendorFault, detail: string, status: number | null = null) {
    super(`${vendor}: ${detail}`);
    this.name = 'VendorError';
    this.vendor = vendor;
    this.fault = fault;
    this.detail = detail;
    this.status = status;
  }
}

/** Out of credits, over quota, unpaid — anything that no other lead in this run will survive. */
const EXHAUSTED = /\b(insufficient|not enough|no remaining|out of|depleted|exhausted|ran out)\b[^.]{0,40}\b(credit|balance|fund|quota|token)|\b(credit|balance|fund|quota)\b[^.]{0,30}\b(insufficient|exhausted|depleted|empty|zero|too low|expired)|payment required|subscription (expired|inactive)/i;

/** Bad or missing key. Also fatal for the run, but it is a different thing to say. */
const AUTH = /\b(unauthori[sz]ed|forbidden|invalid (api )?(key|token)|authentication failed)\b/i;

/**
 * Classify a non-OK vendor response. `status` and `body` are the HTTP status and the raw
 * response text — nothing is parsed, because an error body is not reliably JSON.
 */
export function classifyVendorResponse(vendor: string, status: number, body: string): VendorError {
  const detail = body.trim().slice(0, 300) || `HTTP ${status}`;

  // 402 means exactly this and nothing else, so it needs no text match.
  if (status === 402) return new VendorError(vendor, 'no_credits', detail, status);
  if (EXHAUSTED.test(body)) return new VendorError(vendor, 'no_credits', detail, status);
  // 429 is normally rate limiting — only a credit/quota wording makes it terminal, and
  // EXHAUSTED has already had its chance above.
  if (status === 401 || status === 403 || AUTH.test(body)) {
    return new VendorError(vendor, 'auth', detail, status);
  }
  return new VendorError(vendor, 'vendor_error', detail, status);
}

/**
 * Some vendors answer 200 and put the refusal in the body. Returns null when the payload
 * looks normal.
 */
export function vendorErrorInBody(vendor: string, json: unknown): VendorError | null {
  const j = (json ?? {}) as Record<string, unknown>;
  const nested = j.status as Record<string, unknown> | undefined;
  const text = [j.error, j.message, j.detail, nested?.message]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
  if (!text) return null;
  if (EXHAUSTED.test(text)) return new VendorError(vendor, 'no_credits', text.slice(0, 300), 200);
  if (AUTH.test(text)) return new VendorError(vendor, 'auth', text.slice(0, 300), 200);
  return null;
}

/**
 * Should the whole run stop, or just this lead?
 *
 * Only a fault that belongs to the ACCOUNT stops the run. A lead the vendor could not use
 * — no name on file, no address — is this lead's problem and the next one deserves its
 * turn. An unclassified transport failure is treated as per-lead: the loop below it counts
 * consecutive failures and gives up on its own if the vendor is simply down, which does
 * not need guessing at here.
 */
export function isRunFatal(err: unknown): err is VendorError {
  return err instanceof VendorError && (err.fault === 'no_credits' || err.fault === 'auth');
}

/**
 * Read a vendor response, or throw a classified VendorError.
 *
 * ── The 200-with-a-login-page trap ──────────────────────────────────────────
 * BatchData answers an invalid key with HTTP 200 and its HTML sign-in page. Nothing about
 * the status line says anything is wrong; the request simply never reached the API. Left
 * to `res.json()` that surfaces as "Unexpected token '<'", which reads like a parser bug,
 * is per-lead by default, and would let a blast keep calling a wall it can never get past.
 *
 * So a success that is not JSON is treated as what it almost always is — the key being
 * refused — and stops the run. The wording says "usually" because a maintenance page looks
 * identical from here, and the raw content type is carried through either way.
 */
export async function readVendorJson(vendor: string, res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!res.ok) throw classifyVendorResponse(vendor, res.status, text);

  const ctype = res.headers.get('content-type') ?? '';
  if (!/json/i.test(ctype)) {
    throw new VendorError(
      vendor,
      'auth',
      `answered ${res.status} with ${ctype || 'no content type'} instead of JSON`
      + ' — a rejected API key is the usual cause',
      res.status,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Claims JSON and is not. Could be a blip, so this stays per-lead and the
    // consecutive-failure breaker decides if it is really the vendor.
    throw new VendorError(vendor, 'vendor_error', `sent a ${ctype} body that is not valid JSON`, res.status);
  }

  const refused = vendorErrorInBody(vendor, json);
  if (refused) throw refused;
  return json;
}
