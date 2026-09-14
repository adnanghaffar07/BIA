/**
 * Minimal RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from a library because it runs in the browser on a
 * file a user picked, and the whole job is ~60 lines. It handles the three things a
 * naive `split(',')` gets wrong, all of which appear in real exports:
 *
 *   • quoted fields containing commas      "Smith, John"
 *   • escaped quotes inside quoted fields  "He said ""hi"""
 *   • newlines inside quoted fields        a note spanning two lines
 *
 * It also strips a UTF-8 BOM, which Excel writes and which otherwise turns the first
 * header into "﻿Email" and silently breaks auto-detection.
 */

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  /** Rows whose column count disagrees with the header — surfaced, never dropped silently. */
  ragged: number;
};

export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }            // CRLF — handled by the \n below
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  // Trailing field/row, unless the file ended with a clean newline.
  if (field !== '' || row.length) endRow();

  // Drop entirely blank trailing lines, which almost every export ends with.
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const ragged = rows.filter((r) => r.length !== headers.length).length;
  return { headers, rows, ragged };
}

/** CRM-side fields a CSV column can be mapped onto. Email is the only required one. */
export const IMPORT_FIELDS = [
  { key: 'email', label: 'Email', required: true },
  { key: 'firstName', label: 'First name', required: false },
  { key: 'lastName', label: 'Last name', required: false },
  { key: 'companyName', label: 'Company', required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key'];

/**
 * Guess which column is which from the header text.
 *
 * A guess only — every one is shown in the mapping step and can be overridden. Header
 * names in real files are not ours to predict ("Email", "email_address", "E-Mail",
 * "Owner Email"), which is exactly why mapping is a step rather than an assumption.
 */
export function guessMapping(headers: string[]): Partial<Record<ImportFieldKey, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const find = (...patterns: RegExp[]): string | undefined => {
    for (const p of patterns) {
      const hit = headers.find((h) => p.test(norm(h)));
      if (hit) return hit;
    }
    return undefined;
  };
  return {
    // "email" before "coinsuredemail" so the insured wins when both exist.
    email: find(/^email$/, /^emailaddress$/, /^owneremail$/, /^insuredemail$/, /email/),
    firstName: find(/^firstname$/, /^first$/, /^fname$/, /firstname/),
    lastName: find(/^lastname$/, /^last$/, /^lname$/, /^surname$/, /lastname/),
    companyName: find(/^company$/, /^companyname$/, /^business$/, /company/),
  };
}
