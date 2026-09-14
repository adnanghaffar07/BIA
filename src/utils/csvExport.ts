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
  // Email/Phone columns are generated per export — see contactColumns() — because how
  // many a lead has depends on what its skip trace returned.

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

/** A row as it arrives here: the flat DB shape, whose keys vary by query. */
type LeadRow = Record<string, unknown>;

/**
 * Every contact a skip trace found, in the order it returned them.
 *
 * `emailsAll` / `phonesAll` hold the complete list; email1/2 and phone1/2 are the first
 * two of it. A lead traced before those columns existed, or one whose contacts were
 * typed in by hand, has no list — fall back to the numbered columns so such a lead still
 * exports its contacts rather than an empty cell.
 */
const contactList = (lead: LeadRow, key: 'emailsAll' | 'phonesAll', slots: string[]): string[] => {
  const raw = lead?.[key];
  // Postgres JSONB arrives parsed, but a driver or a cached payload can hand back the
  // raw JSON string, so accept both rather than silently exporting nothing.
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim().startsWith('[')
      ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
      : [];

  // The numbered slots come FIRST and are unioned in, never merely used as a fallback.
  // They hold the producer's working contacts and are filled once and then left alone,
  // so after a re-trace they can hold an address the current list no longer carries —
  // observed live: email1/email2 held two addresses absent from a later trace's results.
  // Preferring the list alone would drop exactly those from the file.
  const ordered = [
    ...slots.map((s) => val(lead, s)),
    ...(list as unknown[]).map((v) => String(v ?? '').trim()),
  ].filter(Boolean);

  const seen = new Set<string>();
  return ordered.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const emailsOf = (lead: LeadRow) => contactList(lead, 'emailsAll', ['email1', 'email2', 'owner2Email']);
const phonesOf = (lead: LeadRow) => contactList(lead, 'phonesAll', ['phone1', 'phone2', 'owner2Phone']);

/**
 * How many numbered contact columns to emit before the rest go into one overflow cell.
 *
 * A handful of leads carry twenty-odd addresses, and sizing every export to the worst
 * case would add twenty mostly-empty columns to a file whose typical lead has three.
 */
const MAX_CONTACT_COLUMNS = 10;

/**
 * Contact columns sized to the data actually being exported.
 *
 * The count is taken from the widest lead in THIS set, so an export of leads with three
 * emails gets three columns, not ten. Header names stay stable ("Email 1", "Email 2", …)
 * so a downstream mail merge keeps working as the count grows.
 */
function contactColumns(leads: LeadRow[]): Column[] {
  const width = (pick: (l: LeadRow) => string[]) =>
    Math.min(MAX_CONTACT_COLUMNS, Math.max(1, ...leads.map((l) => pick(l).length)));

  const emailWidth = width(emailsOf);
  const phoneWidth = width(phonesOf);
  const cols: Column[] = [];

  for (let i = 0; i < emailWidth; i++) {
    cols.push({ header: `Email ${i + 1}`, get: (l) => emailsOf(l)[i] ?? '' });
  }
  if (leads.some((l) => emailsOf(l).length > MAX_CONTACT_COLUMNS)) {
    cols.push({
      header: 'Additional Emails',
      get: (l) => emailsOf(l).slice(MAX_CONTACT_COLUMNS).join('; '),
    });
  }

  for (let i = 0; i < phoneWidth; i++) {
    cols.push({ header: `Phone ${i + 1}`, get: (l) => phonesOf(l)[i] ?? '' });
  }
  if (leads.some((l) => phonesOf(l).length > MAX_CONTACT_COLUMNS)) {
    cols.push({
      header: 'Additional Phones',
      get: (l) => phonesOf(l).slice(MAX_CONTACT_COLUMNS).join('; '),
    });
  }

  cols.push({ header: 'Emails Found', get: (l) => emailsOf(l).length });
  cols.push({ header: 'Phones Found', get: (l) => phonesOf(l).length });
  return cols;
}

/** Contact columns are inserted directly after Last Name, keeping outreach data up front. */
function columnsFor(leads: LeadRow[]): Column[] {
  const at = COLUMNS.findIndex((c) => c.header === 'Last Name');
  const cut = at >= 0 ? at + 1 : COLUMNS.length;
  return [...COLUMNS.slice(0, cut), ...contactColumns(leads), ...COLUMNS.slice(cut)];
}

/** Build the CSV text. Exported separately so it can be tested without a browser. */
export function buildLeadsCsv(leads: any[]): string {
  const columns = columnsFor(leads);
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const lead of leads) {
    lines.push(columns.map((c) => cell(c.get(lead))).join(','));
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
