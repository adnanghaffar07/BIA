import { sql } from '@/lib/neon';
import { recordVerification, isDeliverable } from './emailVerification.service';
import { insuredEmails, coInsuredEmails } from './recipients.service';
import { readXlsx, looksLikeXlsx } from '@/lib/xlsx';

/**
 * Reading a verifier's result file, planning the import, and applying it.
 *
 * ── Why this is a service and not two copies ────────────────────────────────
 * The same file has to be importable from the command line and from the screen. Written
 * twice, the two would disagree about which column is the status, or about what counts as
 * a duplicate — and the only evidence would be two different numbers for one file. Both
 * callers plan here, and both apply here.
 *
 * ── Plan, then apply ────────────────────────────────────────────────────────
 * Planning touches nothing. It is what the dry run prints and what the upload screen shows
 * before anybody presses confirm, because a verdict file decides which homeowners are
 * mailable and importing the wrong column is silent — every address gets a verdict, they
 * are just verdicts about a column of first names.
 */

export type ImportPlan = {
  /** Which column was chosen, and every heading, so a wrong guess is visible. */
  headers: string[];
  emailCol: number;
  statusCol: number;
  subCol: number;
  rows: Array<{
    email: string;
    status: string;
    subStatus: string | null;
    leadId: string | null;
    propertyId: string | null;
    cohort: string | null;
    personRole: string | null;
  }>;
  counts: {
    dataRows: number;
    blank: number;
    duplicates: number;
    unknownAddress: number;
    deliverable: number;
  };
  byStatus: Array<{ status: string; n: number; deliverable: boolean }>;
  /**
   * Where each block of verdicts came from — one per email/status PAIR, per sheet.
   *
   * A verifier's workbook is not one table. The 9/23 file carries five pairs on a single
   * row (Insured Email 1/2/3 and Co-Insured 1/2), and five more as their own tabs. Reading
   * one pair and reporting success is how 245 of 378 verdicts go missing in silence.
   */
  sources: Array<{
    sheet: string;
    emailColumn: string;
    statusColumn: string;
    rows: number;
    skipped: number;
  }>;
  /** Set when the file cannot be imported at all; every other field is then empty. */
  error: string | null;
};

/**
 * RFC-4180 enough: quoted fields, doubled quotes inside them, commas and newlines within.
 *
 * Hand-rolled rather than split(',') because an owner called "Smith, Jr." in a file that
 * also carries the address would shift every column after it by one — and the importer
 * would then read the town as a verification status and store it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

/**
 * Find the email and status columns rather than assume them.
 *
 * Zoya's exports have come back as "Email Address" + "ZB Status" and as "email" + "status";
 * Frank's validated workbooks use "Insured Email" + "1 Status". Demanding one shape would
 * mean somebody editing headings by hand before every import, which is its own way to get
 * the wrong column.
 */
export function findColumns(header: string[]): { emailCol: number; statusCol: number; subCol: number } {
  const pairs = findColumnPairs(header);
  const lower = header.map((h) => String(h).trim().toLowerCase());
  return {
    emailCol: pairs[0]?.emailCol ?? -1,
    statusCol: pairs[0]?.statusCol ?? -1,
    subCol: lower.findIndex((h) => /sub.?status/.test(h)),
  };
}

const isEmailHeading = (h: string) => /email/.test(h) && !/status/.test(h);
const isStatusHeading = (h: string) => /(zb.*status|status.*zb|^status$|\bstatus\b)/.test(h) && !/sub.?status/.test(h);

/**
 * Every email column paired with the status column that follows it.
 *
 * ── Why pairing, and why "the next one to the right" ────────────────────────
 * The 9/23 workbook's main sheet reads:
 *
 *   Insured Email | 1 Status | Insured Email 2 | 2 Status | Insured Email 3 | 3 Status |
 *   Co-Insured Email 1 | ZB Status 1 | Co-Insured Email 2 | ZB Status 2
 *
 * Nothing in the headings ties "2 Status" to "Insured Email 2" except that it sits beside
 * it — the names do not match, and one pair calls it "ZB Status" while another calls it
 * "Status". Position is the only relationship the file actually expresses, so position is
 * what this reads: each email column takes the first status column to its right that no
 * earlier email column has already claimed.
 *
 * An email column with no status after it is dropped. A file listing addresses with no
 * verdicts is not a verification result, and guessing a verdict for them is the one thing
 * this must never do.
 */
export function findColumnPairs(header: string[]): Array<{ emailCol: number; statusCol: number }> {
  const lower = header.map((h) => String(h ?? '').trim().toLowerCase());
  const pairs: Array<{ emailCol: number; statusCol: number }> = [];
  let cursor = 0;

  for (let i = 0; i < lower.length; i++) {
    if (!isEmailHeading(lower[i])) continue;
    const from = Math.max(i + 1, cursor);
    let statusCol = -1;
    for (let j = from; j < lower.length; j++) {
      // Stop at the next email column: a status beyond it belongs to that one.
      if (isEmailHeading(lower[j])) break;
      if (isStatusHeading(lower[j])) { statusCol = j; break; }
    }
    if (statusCol >= 0) {
      pairs.push({ emailCol: i, statusCol });
      cursor = statusCol + 1;
    }
  }
  return pairs;
}

const norm = (e: unknown) => String(e ?? '').trim().toLowerCase();

/** Read the file and work out exactly what would be written. Touches nothing. */
/**
 * Read a verifier's file and work out exactly what would be written. Touches nothing.
 *
 * Takes BYTES, not text. A .xlsx is a zip, and reading one as a string produces mojibake
 * that a CSV parser happily splits into thousands of nonsense "headings" — which is what
 * the upload screen printed back at somebody who uploaded the file they actually had.
 */
export async function planVerificationImport(input: Buffer | string): Promise<ImportPlan> {
  const empty = {
    headers: [] as string[], emailCol: -1, statusCol: -1, subCol: -1,
    rows: [], byStatus: [], sources: [],
    counts: { dataRows: 0, blank: 0, duplicates: 0, unknownAddress: 0, deliverable: 0 },
  };

  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;

  /**
   * One shape for both kinds of file: a list of named sheets of rows. A CSV is simply a
   * workbook with one unnamed sheet, so nothing below has to know which it was reading.
   */
  let sheets: Array<{ name: string; rows: string[][] }>;
  if (looksLikeXlsx(buf)) {
    try {
      sheets = readXlsx(buf);
    } catch (e) {
      return { ...empty, error: `That .xlsx could not be read: ${e instanceof Error ? e.message : 'unknown error'}` };
    }
  } else {
    const text = buf.toString('utf8');
    /**
     * A file that is neither a zip nor text will be full of replacement characters. Saying
     * so beats parsing it and reporting a thousand headings made of binary.
     */
    if (/\uFFFD/.test(text.slice(0, 4096))) {
      return { ...empty, error: 'That file is not a CSV or an .xlsx — it could not be read as either.' };
    }
    sheets = [{ name: '', rows: parseCsv(text) }];
  }

  const usable = sheets
    .map((s) => ({ ...s, pairs: s.rows.length >= 2 ? findColumnPairs(s.rows[0].map((h) => String(h ?? '').trim())) : [] }))
    .filter((s) => s.pairs.length);

  if (!usable.length) {
    // The headings of the biggest sheet, so "could not find the columns" is actionable —
    // and capped, because an unreadable file's "headings" are whatever the bytes said.
    const biggest = sheets.slice().sort((a, b) => (b.rows[0]?.length ?? 0) - (a.rows[0]?.length ?? 0))[0];
    const headers = (biggest?.rows[0] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean).slice(0, 40);
    return {
      ...empty, headers,
      error: sheets.length > 1
        ? 'None of the sheets in that workbook has an email column with a status column beside it.'
        : 'Could not find an email column and a status column in that file.',
    };
  }

  /**
   * Every address we hold, attributed per person, built once.
   *
   * A lookup per row would be thousands of queries for one workbook. Attribution comes from
   * the recipient rules rather than the email columns, because a trace files addresses per
   * person inside its payload — reading email1 directly credits the co-insured's address to
   * the insured.
   */
  const leads = await sql`
    SELECT "id","propertyId","cohort","email1","email2","owner2Email","emailsAll","skipTraceData",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName"
      FROM "Lead"` as Array<Record<string, unknown>>;

  const owner = new Map<string, { l: Record<string, unknown>; role: 'insured' | 'coInsured' }>();
  for (const l of leads) {
    for (const e of insuredEmails(l)) if (!owner.has(norm(e))) owner.set(norm(e), { l, role: 'insured' });
    for (const e of coInsuredEmails(l)) if (!owner.has(norm(e))) owner.set(norm(e), { l, role: 'coInsured' });
  }

  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const seen = new Set<string>();
  const byStatus = new Map<string, number>();
  const rows: ImportPlan['rows'] = [];
  const sources: ImportPlan['sources'] = [];
  let blank = 0, duplicates = 0, unknownAddress = 0, dataRows = 0;

  for (const sheet of usable) {
    const headers = sheet.rows[0].map((h) => String(h ?? '').trim());
    const subCol = headers.findIndex((h) => /sub.?status/i.test(h));

    for (const pair of sheet.pairs) {
      let took = 0, skipped = 0;
      for (const r of sheet.rows.slice(1)) {
        const email = norm(r[pair.emailCol]);
        const status = String(r[pair.statusCol] ?? '').trim().toLowerCase();

        /**
         * A cell that is not an address is SKIPPED, not imported.
         *
         * These sheets are ragged: a lead with one insured email still occupies a line on
         * the "Insured 3" tab, and its cells shift left — so the email column holds a phone
         * number or a row count. 78 rows of one tab look like that. Storing them would file
         * "(917) 846-0320" as an email address with a verdict attached to it.
         */
        if (!email || !status) { blank++; skipped++; continue; }
        if (!EMAIL.test(email)) { skipped++; continue; }

        dataRows++;
        // First answer wins, across the whole workbook — the main sheet and the per-address
        // tabs carry the same verdicts, so without this every one would count twice.
        if (seen.has(email)) { duplicates++; continue; }
        seen.add(email);

        byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
        const hit = owner.get(email);
        if (!hit) unknownAddress++;

        rows.push({
          email,
          status,
          subStatus: subCol >= 0 ? (String(r[subCol] ?? '').trim() || null) : null,
          leadId: hit ? String(hit.l.id) : null,
          propertyId: hit?.l.propertyId ? String(hit.l.propertyId) : null,
          cohort: hit?.l.cohort ? String(hit.l.cohort) : null,
          personRole: hit?.role ?? null,
        });
        took++;
      }

      sources.push({
        sheet: sheet.name || '(the file)',
        emailColumn: headers[pair.emailCol] ?? '',
        statusColumn: headers[pair.statusCol] ?? '',
        rows: took,
        skipped,
      });
    }
  }

  const first = usable[0];
  const firstPair = first.pairs[0];
  const firstHeaders = first.rows[0].map((h) => String(h ?? '').trim());

  return {
    headers: firstHeaders,
    emailCol: firstPair.emailCol,
    statusCol: firstPair.statusCol,
    subCol: firstHeaders.findIndex((h) => /sub.?status/i.test(h)),
    rows,
    sources,
    counts: {
      dataRows,
      blank,
      duplicates,
      unknownAddress,
      deliverable: rows.filter((w) => isDeliverable(w.status)).length,
    },
    byStatus: [...byStatus.entries()]
      .map(([status, n]) => ({ status, n, deliverable: isDeliverable(status) }))
      .sort((a, b) => b.n - a.n),
    error: null,
  };
}

/** Write a plan. Returns how many verdicts landed. */
export async function applyVerificationImport(
  plan: ImportPlan,
  opts: { label?: string | null; source?: string } = {},
): Promise<number> {
  let done = 0;
  for (const r of plan.rows) {
    await recordVerification({
      ...r,
      source: opts.source ?? 'zerobounce',
      batchLabel: opts.label ?? null,
      raw: null,
    });
    done++;
  }
  return done;
}
