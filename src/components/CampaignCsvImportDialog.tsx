'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack,
  TextField, MenuItem, Chip, Alert, Divider, Table, TableHead, TableRow, TableCell,
  TableBody, CircularProgress, ListItemIcon, ListItemText, FormControlLabel, Switch,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmailIcon from '@mui/icons-material/EmailOutlined';
import PersonIcon from '@mui/icons-material/PersonOutlined';
import WorkIcon from '@mui/icons-material/WorkOutlined';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined';
import PhoneIcon from '@mui/icons-material/PhoneOutlined';
import LanguageIcon from '@mui/icons-material/Language';
import PlaceIcon from '@mui/icons-material/PlaceOutlined';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import DataObjectIcon from '@mui/icons-material/DataObjectOutlined';
import BlockIcon from '@mui/icons-material/HighlightOffOutlined';
import { parseCsv } from '@/utils/csvParse';

/**
 * CSV import, mapped column by column.
 *
 * The file's columns drive the screen — one row each, showing the header, the type it
 * will be imported as, and real sample values from the file. Mapping the other way
 * round (a dropdown per CRM field listing the columns) hides any column the operator
 * did not think to look for, and an exported BIA sheet has ~40 of them.
 *
 * ── Several columns can be typed as Email ─────────────────────────────────────
 * A deep skip trace returns multiple addresses for one household, and the export now
 * writes them as Email 1 … Email 10. The sending platform stores ONE address per lead,
 * so each additional Email column becomes its own lead carrying the same name and
 * custom variables. That is the only shape in which the extra addresses actually get
 * sent to; a lead can hold them as variables instead, but nothing is ever delivered
 * there. The row count this produces is shown before importing, because it is not the
 * number of rows in the file.
 */

const MAX_ROWS = 300;

type FieldType =
  | 'email' | 'firstName' | 'lastName' | 'jobTitle' | 'companyName'
  | 'personalization' | 'phone' | 'website' | 'location' | 'linkedin'
  | 'custom' | 'skip';

const TYPES: Array<{ key: FieldType; label: string; icon: React.ReactNode; colour?: string }> = [
  { key: 'email', label: 'Email', icon: <EmailIcon fontSize="small" sx={{ color: '#1a73e8' }} /> },
  { key: 'firstName', label: 'First Name', icon: <PersonIcon fontSize="small" sx={{ color: '#e8a33d' }} /> },
  { key: 'lastName', label: 'Last Name', icon: <PersonIcon fontSize="small" sx={{ color: '#e8a33d' }} /> },
  { key: 'jobTitle', label: 'Job Title', icon: <WorkIcon fontSize="small" sx={{ color: '#b98900' }} /> },
  { key: 'companyName', label: 'Company Name', icon: <BusinessIcon fontSize="small" sx={{ color: '#c2410c' }} /> },
  { key: 'personalization', label: 'Personalization', icon: <AutoAwesomeIcon fontSize="small" sx={{ color: '#3b9ad9' }} /> },
  { key: 'phone', label: 'Phone', icon: <PhoneIcon fontSize="small" sx={{ color: '#5c6b78' }} /> },
  { key: 'website', label: 'Website', icon: <LanguageIcon fontSize="small" sx={{ color: '#2e9e5b' }} /> },
  { key: 'location', label: 'Location', icon: <PlaceIcon fontSize="small" sx={{ color: '#d93025' }} /> },
  { key: 'linkedin', label: 'LinkedIn', icon: <LinkedInIcon fontSize="small" sx={{ color: '#0a66c2' }} /> },
  { key: 'custom', label: 'Custom Variable', icon: <DataObjectIcon fontSize="small" sx={{ color: '#2e9e5b' }} /> },
  { key: 'skip', label: 'Do not import', icon: <BlockIcon fontSize="small" sx={{ color: '#d93025' }} /> },
];

/** Types that may only be claimed by one column; Email and Custom Variable may repeat. */
const SINGLE_USE: FieldType[] = [
  'firstName', 'lastName', 'jobTitle', 'companyName', 'personalization',
  'phone', 'website', 'location', 'linkedin',
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * First guess at a column's type from its header.
 *
 * Every Email N column is typed as Email so a BIA export lands fully mapped; anything
 * unrecognised defaults to "Do not import" rather than Custom Variable, so nothing is
 * pushed to the platform that the operator did not look at.
 */
function guessType(header: string): FieldType {
  const h = norm(header);
  if (/^email\d*$/.test(h) || h === 'emailaddress' || /^additionalemails?$/.test(h)) return 'email';
  if (/^phone\d*$/.test(h) || /^additionalphones?$/.test(h)) return 'phone';
  if (h === 'firstname' || h === 'first' || h === 'fname') return 'firstName';
  if (h === 'lastname' || h === 'last' || h === 'lname' || h === 'surname') return 'lastName';
  if (h === 'company' || h === 'companyname' || h === 'business') return 'companyName';
  if (h === 'jobtitle' || h === 'title') return 'jobTitle';
  if (h === 'website' || h === 'url' || h === 'domain') return 'website';
  if (h === 'linkedin' || h === 'linkedinurl') return 'linkedin';
  if (h === 'city' || h === 'location' || h === 'state' || h === 'address') return 'location';
  return 'skip';
}

/** One lead as the import endpoint accepts it. */
type ImportLead = {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  customVariables?: Record<string, string>;
};

type Tally = { added: number; failed: number; skipped: Array<{ email: string; reason: string }> };

export default function CampaignCsvImportDialog({
  open, onClose, campaignId, campaignName, onFinished,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
  onFinished: (t: Tally) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [types, setTypes] = useState<FieldType[]>([]);
  const [ragged, setRagged] = useState(0);
  const [splitEmails, setSplitEmails] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Tally | null>(null);

  const pickFile = () => fileRef.current?.click();

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.headers.length) throw new Error('That file has no header row.');
      if (!parsed.rows.length) throw new Error('That file has headers but no rows.');
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setTypes(parsed.headers.map(guessType));
      setRagged(parsed.rows.filter((r) => r.length !== parsed.headers.length).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
      setHeaders([]); setRows([]); setTypes([]); setFileName(null);
    }
  };

  const setType = (i: number, t: FieldType) =>
    setTypes((prev) => prev.map((v, n) => (n === i ? t : v)));

  /** Up to four real values from the column, so a mis-typed column is visible. */
  const samplesFor = (i: number) =>
    rows.map((r) => (r[i] ?? '').trim()).filter(Boolean).slice(0, 4);

  const indexesOf = useCallback(
    (t: FieldType) => types.map((v, i) => (v === t ? i : -1)).filter((i) => i >= 0),
    [types],
  );

  const emailCols = useMemo(() => indexesOf('email'), [indexesOf]);

  /**
   * Turn the file into leads.
   *
   * One lead per address when several columns are typed as Email: the platform holds a
   * single address per lead, so the alternative is silently dropping every address but
   * the first. A cell holding several addresses ("a@x.com; b@x.com" — the export's
   * overflow column) is split on the usual separators for the same reason.
   */
  const built = useMemo(() => {
    if (!emailCols.length) return [];
    const first = (t: FieldType) => { const i = indexesOf(t)[0]; return i === undefined ? -1 : i; };
    const fi = first('firstName'), li = first('lastName'), ci = first('companyName');
    const customIdx = indexesOf('custom')
      .concat(indexesOf('phone'), indexesOf('website'), indexesOf('location'),
              indexesOf('linkedin'), indexesOf('jobTitle'), indexesOf('personalization'));

    const out: ImportLead[] = [];
    for (const r of rows) {
      const vars: Record<string, string> = {};
      for (const i of customIdx) {
        const v = (r[i] ?? '').trim();
        if (v) vars[norm(headers[i]) || `col${i}`] = v;
      }
      const base = {
        firstName: fi >= 0 ? (r[fi] ?? '').trim() || undefined : undefined,
        lastName: li >= 0 ? (r[li] ?? '').trim() || undefined : undefined,
        companyName: ci >= 0 ? (r[ci] ?? '').trim() || undefined : undefined,
        ...(Object.keys(vars).length ? { customVariables: vars } : {}),
      };

      const addresses = emailCols
        .flatMap((i) => (r[i] ?? '').split(/[;,]/))
        .map((e) => e.trim())
        .filter(Boolean);

      const unique = [...new Map(addresses.map((a) => [a.toLowerCase(), a])).values()];
      for (const email of splitEmails ? unique : unique.slice(0, 1)) {
        out.push({ email, ...base });
      }
    }
    return out;
  }, [rows, headers, splitEmails, emailCols, indexesOf]);

  const valid = built.filter((b) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email));
  const invalid = built.length - valid.length;
  const overCap = valid.length > MAX_ROWS;
  const extraLeads = valid.length - rows.length;

  const runImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leads: valid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      const t: Tally = { added: json.added ?? 0, failed: json.failed ?? 0, skipped: json.skipped ?? [] };
      setResult(t);
      onFinished(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const canImport = valid.length > 0 && !overCap && !importing && !result;

  return (
    <Dialog open={open} onClose={importing ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {headers.length && !result ? 'File processed' : 'Import leads from CSV'}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          into {campaignName}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!result && (
          <>
            <Box sx={{ mb: headers.length ? 2.5 : 0 }}>
              <input
                ref={fileRef} type="file" accept=".csv,text/csv" hidden
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={pickFile} disabled={importing}>
                  {fileName ? 'Choose a different file' : 'Choose CSV file'}
                </Button>
                {headers.length > 0 && (
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                    <CheckCircleIcon fontSize="small" sx={{ color: '#2e9e5b' }} />
                    <Typography variant="body2" sx={{ color: '#2e9e5b', fontWeight: 600 }}>
                      File processed. Detected {rows.length.toLocaleString()} data row
                      {rows.length === 1 ? '' : 's'}.
                    </Typography>
                  </Stack>
                )}
              </Stack>
              {ragged > 0 && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  {ragged} row{ragged === 1 ? ' has' : 's have'} a different number of columns than
                  the header. They are still imported — check the samples below.
                </Alert>
              )}
            </Box>

            {headers.length > 0 && (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, width: '28%' }}>Column Name</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: '34%' }}>Select Type</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Samples</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {headers.map((h, i) => {
                      const t = types[i];
                      const claimedElsewhere = (k: FieldType) =>
                        SINGLE_USE.includes(k) && types.some((v, n) => v === k && n !== i);
                      return (
                        <TableRow key={`${h}-${i}`} hover>
                          <TableCell sx={{ fontWeight: 600, verticalAlign: 'top', pt: 2 }}>{h}</TableCell>
                          <TableCell sx={{ verticalAlign: 'top', pt: 1.5 }}>
                            <TextField
                              select size="small" fullWidth value={t}
                              onChange={(e) => setType(i, e.target.value as FieldType)}
                              slotProps={{ select: { renderValue: (v) => {
                                const opt = TYPES.find((o) => o.key === v)!;
                                return (
                                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                    {opt.icon}
                                    <span style={{ color: opt.key === 'skip' ? '#d93025' : undefined }}>{opt.label}</span>
                                  </Stack>
                                );
                              } } }}
                            >
                              {TYPES.map((o) => (
                                <MenuItem key={o.key} value={o.key} disabled={claimedElsewhere(o.key)}>
                                  <ListItemIcon sx={{ minWidth: 32 }}>{o.icon}</ListItemIcon>
                                  <ListItemText
                                    primary={o.label}
                                    secondary={claimedElsewhere(o.key) ? 'already used by another column' : undefined}
                                  />
                                </MenuItem>
                              ))}
                            </TextField>
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', pt: 2, color: '#5c6b78', fontSize: 12.5 }}>
                            {samplesFor(i).length
                              ? samplesFor(i).map((s, n) => <Box key={n} sx={{ lineHeight: 1.6 }}>{s}</Box>)
                              : <em>empty</em>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <Divider sx={{ my: 2 }} />

                {emailCols.length === 0 ? (
                  <Alert severity="info">
                    Type at least one column as <strong>Email</strong> — nothing can be imported
                    without an address.
                  </Alert>
                ) : (
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip size="small" label={`${emailCols.length} email column${emailCols.length === 1 ? '' : 's'}`} sx={{ fontWeight: 600 }} />
                      <Chip
                        size="small"
                        label={`${valid.length.toLocaleString()} lead${valid.length === 1 ? '' : 's'} to import`}
                        sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }}
                      />
                      {invalid > 0 && (
                        <Chip size="small" label={`${invalid} skipped — not an email address`} sx={{ bgcolor: '#fff3d6', color: '#8a5a00', fontWeight: 600 }} />
                      )}
                    </Stack>

                    {emailCols.length > 1 && (
                      <FormControlLabel
                        control={<Switch size="small" checked={splitEmails} onChange={(e) => setSplitEmails(e.target.checked)} />}
                        label={
                          <Typography variant="body2">
                            Import every address as its own lead
                            {splitEmails && extraLeads > 0
                              ? ` — ${rows.length.toLocaleString()} rows become ${valid.length.toLocaleString()} leads`
                              : ' (off: only the first address per row)'}
                          </Typography>
                        }
                      />
                    )}

                    {splitEmails && emailCols.length > 1 && (
                      <Alert severity="warning">
                        A skip trace returns every address linked to the property, which often
                        includes relatives and previous residents rather than the insured. Each
                        one imported here receives the sequence.
                      </Alert>
                    )}

                    {overCap && (
                      <Alert severity="error">
                        {valid.length.toLocaleString()} leads exceeds the {MAX_ROWS} per import.
                        Narrow the file, or turn off one address per lead.
                      </Alert>
                    )}
                  </Stack>
                )}
              </>
            )}
          </>
        )}

        {result && (
          <Box>
            <Alert severity={result.added > 0 ? 'success' : 'warning'} sx={{ mb: 2 }}>
              {result.added.toLocaleString()} lead{result.added === 1 ? '' : 's'} imported into {campaignName}.
            </Alert>
            {result.skipped.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  {result.skipped.length.toLocaleString()} not added
                </Typography>
                <Box sx={{ maxHeight: 260, overflowY: 'auto' }}>
                  <Table size="small">
                    <TableBody>
                      {result.skipped.slice(0, 100).map((s, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ fontSize: 12.5 }}>{s.email || <em>(blank)</em>}</TableCell>
                          <TableCell sx={{ fontSize: 12.5, color: '#8a5a00' }}>{s.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={importing}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button
            variant="contained" onClick={runImport} disabled={!canImport}
            startIcon={importing ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {importing ? 'Importing…' : `Import ${valid.length.toLocaleString()} lead${valid.length === 1 ? '' : 's'}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
