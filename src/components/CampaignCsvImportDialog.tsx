'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Stack,
  TextField, MenuItem, Chip, Alert, Divider, Table, TableHead,
  TableRow, TableCell, TableBody, FormControlLabel, Switch, LinearProgress,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { parseCsv, guessMapping, IMPORT_FIELDS, ImportFieldKey } from '@/utils/csvParse';

/**
 * Import leads into a campaign from a CSV.
 *
 * Three things shape this:
 *
 *  1. Column names are never assumed. The file's headers are shown and mapped
 *     explicitly; auto-detection only pre-fills the dropdowns.
 *  2. A column already assigned to one field is DISABLED for the others. The
 *     platform's own import lets you pick the same field twice and only complains
 *     after you hit continue — QA hit exactly that. Preventing it is cheaper than
 *     explaining it.
 *  3. Unmapped columns are not discarded — they ride along as merge variables the
 *     sequence copy can use, which is usually why they were in the file.
 *
 * The import itself posts to the same route the single-lead form uses, so the cap,
 * the email validation and the workspace-wide dedup apply identically. There is no
 * second code path to keep in sync.
 */

const MAX_ROWS = 300;
const PREVIEW_ROWS = 4;

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
  const [ragged, setRagged] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<ImportFieldKey, string>>>({});
  const [includeExtras, setIncludeExtras] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Tally | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.headers.length) throw new Error('That file has no header row.');
      if (!parsed.rows.length) throw new Error('That file has headers but no rows.');
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setRagged(parsed.ragged);
      setMapping(guessMapping(parsed.headers));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
      setFileName(null); setHeaders([]); setRows([]);
    }
  };

  /** A column assigned to one field cannot be chosen for another. */
  const takenBy = (col: string, exceptField: ImportFieldKey): ImportFieldKey | null => {
    for (const [k, v] of Object.entries(mapping)) {
      if (k !== exceptField && v === col) return k as ImportFieldKey;
    }
    return null;
  };

  const emailCol = mapping.email;
  const emailIdx = emailCol ? headers.indexOf(emailCol) : -1;

  /** Rows turned into the shape the add-leads route takes. */
  const mapped = useMemo(() => {
    if (emailIdx < 0) return [];
    const idxOf = (k: ImportFieldKey) => (mapping[k] ? headers.indexOf(mapping[k]!) : -1);
    const fi = idxOf('firstName'), li = idxOf('lastName'), ci = idxOf('companyName');
    const usedIdx = new Set([emailIdx, fi, li, ci].filter((n) => n >= 0));

    return rows.map((r) => {
      const extras: Record<string, string> = {};
      if (includeExtras) {
        headers.forEach((h, i) => {
          if (usedIdx.has(i)) return;
          const v = (r[i] ?? '').trim();
          if (v) extras[h.replace(/\s+/g, '_').toLowerCase()] = v;
        });
      }
      return {
        email: (r[emailIdx] ?? '').trim(),
        firstName: fi >= 0 ? (r[fi] ?? '').trim() : undefined,
        lastName: li >= 0 ? (r[li] ?? '').trim() : undefined,
        companyName: ci >= 0 ? (r[ci] ?? '').trim() : undefined,
        ...(Object.keys(extras).length ? { customVariables: extras } : {}),
      };
    });
  }, [rows, headers, mapping, emailIdx, includeExtras]);

  const withEmail = mapped.filter((m) => m.email);
  const blankEmails = mapped.length - withEmail.length;
  const overCap = withEmail.length > MAX_ROWS;

  const runImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/lead-campaigns/${campaignId}/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leads: withEmail }),
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

  const canImport = withEmail.length > 0 && !overCap && !importing && !result;

  return (
    <Dialog open={open} onClose={importing ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        Import leads from CSV
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          into {campaignName}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* ── 1. file ── */}
        {!result && (
          <Box sx={{ mb: 2 }}>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={pickFile} disabled={importing}>
                {fileName ? 'Choose a different file' : 'Choose CSV file'}
              </Button>
              {fileName && (
                <Typography variant="body2" color="text.secondary">
                  {fileName} — {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'},
                  {' '}{headers.length} column{headers.length === 1 ? '' : 's'}
                </Typography>
              )}
            </Stack>
            {ragged > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {ragged} row{ragged === 1 ? ' has' : 's have'} a different number of columns than the
                header. They are still imported — check them if the mapping preview looks wrong.
              </Alert>
            )}
          </Box>
        )}

        {/* ── 2. mapping ── */}
        {headers.length > 0 && !result && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Map your columns</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Pre-filled from the header names — change anything that looks wrong. A column used
              once is unavailable for the other fields.
            </Typography>

            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
              {IMPORT_FIELDS.map((f) => (
                <TextField
                  key={f.key} select size="small" sx={{ minWidth: 205 }}
                  label={f.required ? `${f.label} (required)` : f.label}
                  value={mapping[f.key] ?? ''}
                  error={f.required && !mapping[f.key]}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))}
                >
                  <MenuItem value=""><em>Not mapped</em></MenuItem>
                  {headers.map((h) => {
                    const claimed = takenBy(h, f.key);
                    return (
                      <MenuItem key={h} value={h} disabled={!!claimed}>
                        {h}{claimed ? ` — already used for ${IMPORT_FIELDS.find((x) => x.key === claimed)?.label}` : ''}
                      </MenuItem>
                    );
                  })}
                </TextField>
              ))}
            </Stack>

            <FormControlLabel
              control={<Switch size="small" checked={includeExtras} onChange={(e) => setIncludeExtras(e.target.checked)} />}
              label={
                <Typography variant="body2">
                  Send unmapped columns as merge variables
                </Typography>
              }
            />

            {!emailCol && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Pick the column holding the email address — nothing can be imported without it.
              </Alert>
            )}
          </>
        )}

        {/* ── 3. preview ── */}
        {emailCol && !result && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              <Chip size="small" color="primary" variant="outlined" label={`${withEmail.length} with an email`} />
              {blankEmails > 0 && <Chip size="small" variant="outlined" label={`${blankEmails} blank email — skipped`} />}
              {overCap && <Chip size="small" sx={{ bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 }} label={`over the ${MAX_ROWS} limit`} />}
            </Stack>

            {overCap && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This file has {withEmail.length.toLocaleString()} usable rows; imports are capped at{' '}
                {MAX_ROWS} at a time. Split the file — a run that quietly truncates is worse than
                one that refuses.
              </Alert>
            )}

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['Email', 'First', 'Last', 'Company', 'Merge variables'].map((h) => (
                      <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mapped.slice(0, PREVIEW_ROWS).map((m, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ color: m.email ? undefined : '#b3261e' }}>{m.email || '(blank — skipped)'}</TableCell>
                      <TableCell>{m.firstName || '—'}</TableCell>
                      <TableCell>{m.lastName || '—'}</TableCell>
                      <TableCell>{m.companyName || '—'}</TableCell>
                      <TableCell sx={{ fontSize: 12, color: '#5c6b78', maxWidth: 320 }}>
                        {m.customVariables ? Object.keys(m.customVariables).join(', ') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {mapped.length > PREVIEW_ROWS && (
              <Typography variant="caption" color="text.secondary">
                …and {(mapped.length - PREVIEW_ROWS).toLocaleString()} more
              </Typography>
            )}
          </>
        )}

        {importing && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress sx={{ height: 6, borderRadius: 1, mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Importing {withEmail.length.toLocaleString()} lead{withEmail.length === 1 ? '' : 's'}…
            </Typography>
          </Box>
        )}

        {/* ── 4. result ── */}
        {result && (
          <Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1.5 }}>
              <Chip size="small" sx={{ bgcolor: '#dcfce7', color: '#166534', fontWeight: 600 }} label={`${result.added} imported`} />
              {result.skipped.length > 0 && <Chip size="small" variant="outlined" label={`${result.skipped.length} skipped`} />}
              {result.failed > 0 && <Chip size="small" sx={{ bgcolor: '#fee2e2', color: '#b3261e', fontWeight: 600 }} label={`${result.failed} failed`} />}
            </Stack>
            {result.skipped.length > 0 && (
              <Box sx={{ maxHeight: 220, overflowY: 'auto', mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Not imported:</Typography>
                {result.skipped.map((s, i) => (
                  <Typography key={`${s.email}-${i}`} variant="caption" sx={{ display: 'block', color: '#8a5a00' }}>
                    {s.email || '(blank)'} — {s.reason}
                  </Typography>
                ))}
              </Box>
            )}
            <Alert severity={result.added > 0 ? 'success' : 'info'}>
              {result.added > 0
                ? `${result.added} lead${result.added === 1 ? '' : 's'} imported into ${campaignName}.`
                : 'Nothing was imported.'}
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={importing}>{result ? 'Close' : 'Cancel'}</Button>
        {canImport && (
          <Button variant="contained" onClick={runImport}>
            Import {withEmail.length.toLocaleString()} lead{withEmail.length === 1 ? '' : 's'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
