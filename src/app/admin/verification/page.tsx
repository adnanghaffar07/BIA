'use client';

import React, { useRef, useState } from 'react';
import {
  Container, Box, Typography, Paper, Button, Chip, Table, TableHead, TableRow,
  TableCell, TableBody, CircularProgress, Alert, Stack, TextField, Divider,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';

/**
 * Import ZeroBounce results (Frank, 25 Sep 2026).
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * The importer was a command-line script, which meant every run came through Abdullah:
 * Zoya produces the file and could not put it in. With results arriving per batch, that is
 * a standing bottleneck on the number Frank reads off the cohort ledger.
 *
 * ── Read the file, show the plan, THEN write ────────────────────────────────
 * Choosing a file does nothing but describe it. Importing the wrong column is silent —
 * every address still gets a verdict, they are just verdicts about a column of first names
 * — so the column that was read as the status is the first thing on screen, and nothing is
 * written until somebody has seen it and pressed Import.
 */
type Preview = {
  headers: string[];
  emailColumn: string | null;
  statusColumn: string | null;
  subStatusColumn: string | null;
  counts: { dataRows: number; blank: number; duplicates: number; unknownAddress: number; deliverable: number };
  sources: Array<{ sheet: string; emailColumn: string; statusColumn: string; rows: number; skipped: number }>;
  byStatus: Array<{ status: string; n: number; deliverable: boolean }>;
  willWrite: number;
  sample: Array<{ email: string; status: string; matchedLead: boolean; role: string | null }>;
  committed?: boolean;
  imported?: number;
  total?: number;
};

export default function VerificationImportPage() {
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const post = async (b64: string, commit: boolean) => {
    const res = await fetch(`/api/admin/verification-import${commit ? '?commit=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileB64: b64, label: label.trim() || null }),
    });
    const json = await res.json();
    if (!json.success) {
      // The headings come back on a column failure — without them "could not find a status
      // column" is unactionable, and the next move is always to look at what IS in the file.
      throw new Error(
        json.headers?.length
          ? `${json.error}\nHeadings found: ${json.headers.join(' · ')}`
          : (json.error || 'Could not read that file'),
      );
    }
    return json as Preview;
  };

  const choose = async (file: File) => {
    setError(null); setDone(null); setPreview(null);
    setFileName(file.name);
    setBusy(true);
    try {
      /**
       * Read as BYTES and base64 them. An .xlsx is a zip; file.text() on one produces
       * mojibake that the server then parsed as a CSV, and the screen printed the result
       * back as thousands of nonsense headings.
       *
       * Chunked because String.fromCharCode(...bytes) on a multi-megabyte file blows the
       * argument limit and throws a RangeError that reads like a parsing failure.
       */
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const b64 = btoa(bin);
      setFileB64(b64);
      setPreview(await post(b64, false));
    } catch (e) {
      setFileB64(null);
      setError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!fileB64) return;
    setBusy(true); setError(null);
    try {
      const out = await post(fileB64, true);
      setDone(out);
      setPreview(null);
      setFileB64(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>Email verification import</Typography>
      <Typography variant="body2" sx={{ color: '#5a6675', mb: 3 }}>
        Put a ZeroBounce result file in — .xlsx or .csv. Nothing is written until you have seen what it says.
        A verdict belongs to an address, so re-importing an address replaces its previous
        result rather than adding a second.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
          <Button
            variant="contained"
            component="label"
            startIcon={busy && !preview ? <CircularProgress size={14} color="inherit" /> : <UploadFileIcon />}
            disabled={busy}
          >
            {busy && !preview ? 'Reading…' : 'Choose a file'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); }}
            />
          </Button>
          {fileName && <Chip size="small" label={fileName} />}
          <TextField
            size="small"
            label="Batch name"
            placeholder="9/25 insured #1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            helperText="So a re-check can be told from the original"
            sx={{ minWidth: 260 }}
          />
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{error}</Alert>
      )}

      {done && (
        <Alert icon={<CheckCircleIcon />} severity="success" sx={{ mb: 2 }}>
          Imported <strong>{done.imported}</strong> verdict(s).
          {' '}The table now holds {done.total} in total, {done.counts.deliverable} of this file deliverable.
          {' '}The cohort ledger&apos;s verified column will show them on its next run.
        </Alert>
      )}

      {preview && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          {/*
            The columns first, and in the largest type on the page. Everything else here is
            a count that looks plausible whichever column was read — this is the only part
            that shows whether the file was understood.
          */}
          {/*
            Every email/status pair, listed.
            A verifier's workbook is not one table: the 9/23 file carries five pairs on one
            row and repeats them on five tabs. Showing a single "columns read" line would be
            true of one pair and silent about the other four — which is exactly how 245 of
            378 verdicts would go missing with the screen reporting success.
          */}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Columns read{preview.sources.length > 1 ? ` — ${preview.sources.length} email/status pairs` : ''}
          </Typography>
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Sheet</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Email column</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status column</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Taken</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Skipped</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.sources.map((s, i) => (
                <TableRow key={`${s.sheet}-${s.emailColumn}-${i}`}>
                  <TableCell sx={{ color: '#5a6675' }}>{s.sheet}</TableCell>
                  <TableCell>{s.emailColumn}</TableCell>
                  <TableCell>{s.statusColumn}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: s.rows ? 700 : 400, color: s.rows ? 'inherit' : '#9aa0a6' }}>
                    {s.rows}
                  </TableCell>
                  <TableCell align="right" sx={{ color: '#9aa0a6' }}>{s.skipped}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="caption" sx={{ display: 'block', color: '#8a8f98', mb: 2 }}>
            A pair taking 0 is one whose addresses were already read from an earlier pair —
            these workbooks repeat every verdict on its own tab. Skipped rows are lines where
            the email cell held something that is not an address.
          </Typography>

          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {preview.willWrite.toLocaleString()} verdict(s) would be written
          </Typography>
          <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="body2">
              {preview.counts.dataRows.toLocaleString()} verdict(s) found across the pairs
            </Typography>
            <Typography variant="body2" sx={{ color: preview.counts.duplicates ? '#b26a00' : '#5a6675' }}>
              {preview.counts.duplicates.toLocaleString()} repeated address(es) — first answer kept
            </Typography>
            <Typography variant="body2" sx={{ color: '#5a6675' }}>
              {preview.counts.blank.toLocaleString()} empty cell(s) skipped
            </Typography>
            <Typography variant="body2" sx={{ color: '#5a6675' }}>
              {preview.counts.unknownAddress} not on any card
            </Typography>
          </Stack>

          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Rows</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Counts as mailable</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {preview.byStatus.map((s) => (
                <TableRow key={s.status}>
                  <TableCell>{s.status}</TableCell>
                  <TableCell align="right">{s.n.toLocaleString()}</TableCell>
                  <TableCell sx={{ color: s.deliverable ? '#1b6b2f' : '#8a8f98', fontWeight: s.deliverable ? 700 : 400 }}>
                    {s.deliverable ? 'yes' : 'no'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Typography variant="caption" sx={{ display: 'block', color: '#5a6675', mb: 0.5 }}>
            First few rows, so the pairing is visible:
          </Typography>
          {preview.sample.map((r) => (
            <Typography key={r.email} variant="caption" sx={{ display: 'block', color: '#5a6675', fontFamily: 'monospace' }}>
              {r.email} → {r.status}{r.matchedLead ? ` · ${r.role}` : ' · not on any card'}
            </Typography>
          ))}

          <Alert severity="info" sx={{ mt: 2 }}>
            An address not on any card is still recorded — a later trace may bring it in, and
            the verdict is already true. Only <strong>valid</strong>{' '}
            counts toward the cohort&apos;s verified column.
          </Alert>

          <Button
            variant="contained"
            color="warning"
            onClick={commit}
            disabled={busy || !preview.willWrite}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            sx={{ mt: 2 }}
          >
            {busy ? 'Importing…' : `Import ${preview.willWrite.toLocaleString()} verdict(s)`}
          </Button>
        </Paper>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="caption" sx={{ color: '#8a8f98' }}>
          Large files go through the command line instead:
          {' '}<code>scripts/import-zerobounce.mjs &lt;file.csv&gt; --commit</code>. Both read
          the file the same way.
        </Typography>
      </Box>
    </Container>
  );
}
