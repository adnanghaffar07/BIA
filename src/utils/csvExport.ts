import { Lead } from '@/types/lead';

/**
 * CSV export for lead lists.
 *
 * ── Two bugs fixed here, Sep-2026 QA ─────────────────────────────────────────
 *
 * 1. Every location column exported blank. The rows this receives come straight
 *    from the database and are FLAT (addressStreet, addressCity…), but this file
 *    read the nested REAPI shape (lead.address.street). TypeScript did not catch
 *    it because the rows are typed as Lead, whose `address` is nested — the type
 *    describes the API shape, the data is the DB shape. Every field below now
 *    reads flat first and falls back to nested, so it is correct for both.
 *
 * 2. No Email or Phone columns existed at all, which made the export useless for
 *    the one thing an exported lead list is for. Contact fields now lead the file.
 *
 * Cells are also properly escaped and defused against spreadsheet formula
 * injection — see `cell()`.
 */

/** Read a flat DB column, falling back to the nested API shape. */
const val = (lead: any, flat: string, nested?: string): string => {
  const direct = lead?.[flat];
  if (direct !== undefined && direct !== null && direct !== '') return String(direct);
  if (nested) {
    const v = nested.split('.').reduce((o: any, k) => (o == null ? o : o[k]), lead);
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
};

const yesNo = (v: unknown): string => (v === true ? 'Yes' : v === false ? 'No' : '');
const date = (v: unknown): string => (v ? String(v).slice(0, 10) : '');

/**
 * Quote and escape one cell.
 *
 * A leading =, +, - or @ is prefixed with a single quote: spreadsheets treat such
 * a cell as a formula, so an address like "-- see notes" or anything a producer
 * typed can otherwise execute on open. Exports go to clients and carriers, so this
 * is worth defusing rather than trusting the content.
 */
const cell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  // Quote whenever the value contains a comma, quote, or newline — the old version
  // only checked for commas, so a note containing a quote corrupted every row after it.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

type Column = { header: string; get: (lead: any) => unknown };

/**
 * Contact fields first: this file exists to be worked, and the outreach columns are
 * what a producer or a campaign import needs to find immediately.
 */
const COLUMNS: Column[] = [
  { header: 'Property ID',        get: (l) => val(l, 'propertyId', 'id') || val(l, 'id') },
  { header: 'Grade',              get: (l) => val(l, 'manualGrade') || val(l, 'grade') },
  { header: 'Status',             get: (l) => val(l, 'status') },

  // ── Insured + contact ──
  { header: 'First Name',         get: (l) => val(l, 'owner1FirstName') },
  { header: 'Last Name',          get: (l) => val(l, 'owner1LastName') },
  { header: 'Email',              get: (l) => val(l, 'email1') },
  { header: 'Email 2',            get: (l) => val(l, 'email2') },
  { header: 'Phone',              get: (l) => val(l, 'phone1') },
  { header: 'Phone 2',            get: (l) => val(l, 'phone2') },

  // ── Co-insured ──
  { header: 'Co-Insured First',   get: (l) => val(l, 'owner2FirstName') },
  { header: 'Co-Insured Last',    get: (l) => val(l, 'owner2LastName') },
  { header: 'Co-Insured Email',   get: (l) => val(l, 'owner2Email') },
  { header: 'Co-Insured Phone',   get: (l) => val(l, 'owner2Phone') },

  // ── Property ──
  { header: 'Address',            get: (l) => val(l, 'addressStreet', 'address.street') },
  { header: 'City',               get: (l) => val(l, 'addressCity', 'address.city') },
  { header: 'State',              get: (l) => val(l, 'addressState', 'address.state') },
  { header: 'Zip',                get: (l) => val(l, 'addressZip', 'address.zip') },
  { header: 'County',             get: (l) => val(l, 'addressCounty', 'address.county') },
  { header: 'Property Type',      get: (l) => val(l, 'propertyType') },
  { header: 'Land Use',           get: (l) => val(l, 'landUse') },
  { header: 'Bedrooms',           get: (l) => val(l, 'bedrooms') },
  { header: 'Bathrooms',          get: (l) => val(l, 'bathrooms') },
  { header: 'Square Feet',        get: (l) => val(l, 'squareFeet') },
  { header: 'Year Built',         get: (l) => val(l, 'yearBuilt') },
  { header: 'Roof Year',          get: (l) => val(l, 'roofYear') },
  { header: 'Est. Value',         get: (l) => val(l, 'estimatedValue') },

  // ── Renewal + pricing ──
  { header: 'Effective Date',     get: (l) => date(l?.effectiveDate) },
  { header: 'Engine',             get: (l) => val(l, 'engine') },
  { header: 'Travelers',          get: (l) => val(l, 'travelersEligible') },
  { header: 'Plymouth',           get: (l) => val(l, 'plymouthEligible') },
  { header: 'Band Low',           get: (l) => val(l, 'indicativeBandLow') },
  { header: 'Band High',          get: (l) => val(l, 'indicativeBandHigh') },
  { header: 'Est. Premium',       get: (l) => val(l, 'expectedPremium') },

  // ── Provenance ──
  { header: 'Skip Traced',        get: (l) => yesNo(Boolean(l?.deepSkipTracedAt || l?.skipTraced)) },
  { header: 'Skip Traced On',     get: (l) => date(l?.deepSkipTracedAt || l?.skipTracedAt) },
  { header: 'Flood Zone',         get: (l) => val(l, 'floodZoneType') },
  { header: 'Owner Occupied',     get: (l) => yesNo(l?.ownerOccupied) },
];

/** Build the CSV text. Exported separately so it can be tested without a browser. */
export function buildLeadsCsv(leads: any[]): string {
  const lines = [COLUMNS.map((c) => cell(c.header)).join(',')];
  for (const lead of leads) {
    lines.push(COLUMNS.map((c) => cell(c.get(lead))).join(','));
  }
  // CRLF: what Excel expects, and it keeps quoted multi-line cells intact.
  return lines.join('\r\n');
}

function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Without this the blob is held until the tab closes; a few large exports add up.
  URL.revokeObjectURL(url);
}

export const exportLeadsToCSV = (leads: Lead[]): void => {
  if (!leads?.length) {
    alert('No leads to export');
    return;
  }
  // BOM so Excel reads it as UTF-8 — without it, accented owner names arrive mangled.
  download(
    `﻿${buildLeadsCsv(leads as any[])}`,
    `bia_leads_${new Date().toISOString().slice(0, 10)}.csv`,
    'text/csv;charset=utf-8;',
  );
};

export const exportLeadsToJSON = (leads: Lead[]): void => {
  if (!leads?.length) {
    alert('No leads to export');
    return;
  }
  download(
    JSON.stringify(leads, null, 2),
    `bia_leads_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json;charset=utf-8;',
  );
};
