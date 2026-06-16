'use client';

import { useState } from 'react';
import {
  Box, Button, Typography, Paper, Alert, CircularProgress,
  Stack, Divider, Chip, List, ListItem, ListItemText,
} from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export default function SeedControlPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runSeed = async () => {
    if (!confirm(
      'This will:\n' +
      '• Delete all 27 demo placeholder leads\n' +
      '• Call RealEstateAPI (costs credits)\n' +
      '• Fetch 50 Engine-1 + 50 Engine-2 NJ leads\n' +
      '• Lock REAPI permanently until you unlock it\n\n' +
      'Proceed?'
    )) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const res = await fetch('/api/admin/seed', { method: 'POST' });
    const json = await res.json();

    if (json.success) {
      setResult(json);
    } else {
      setError(json.error || 'Seed failed');
    }
    setLoading(false);
  };

  const unlock = async () => {
    if (!confirm('Remove the REAPI lock? This allows a new seed to run.')) return;
    const res = await fetch('/api/admin/seed', { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      setResult(null);
      setError(null);
      alert('Lock removed. You can now run a fresh seed.');
    } else {
      setError(json.error);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
        REAPI Seed Control
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        One-time fetch of 100 real NJ homeowner leads from RealEstateAPI.
        After seeding, the API is locked and all pages serve from the database.
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5 }}>
          What this does
        </Typography>
        <List dense disablePadding>
          {[
            'Deletes all existing demo / placeholder leads from the database',
            'Calls RealEstateAPI with Engine 1 filter (new mortgages — last 90 days, size 50)',
            'Calls RealEstateAPI with Engine 2 filter (renewals 2022–2025, size 50)',
            'Saves all returned properties to Neon with deduplication',
            'Runs full enrichment: carrier eligibility, lead grade, indicative pricing, coast distance',
            'Sets REAPI lock — API will never be called again until you explicitly unlock',
          ].map((item, i) => (
            <ListItem key={i} disableGutters sx={{ py: 0.25 }}>
              <ListItemText
                primary={<Typography variant="body2">✓ {item}</Typography>}
              />
            </ListItem>
          ))}
        </List>
      </Paper>

      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
          onClick={runSeed}
          disabled={loading}
          color="primary"
        >
          {loading ? 'Fetching & Saving…' : 'Run One-Time Seed'}
        </Button>

        <Button
          variant="outlined"
          size="large"
          startIcon={<LockOpenIcon />}
          onClick={unlock}
          disabled={loading}
          color="warning"
        >
          Remove Lock
        </Button>
      </Stack>

      {error && (
        <Alert severity={error.includes('lock') || error.includes('Lock') ? 'info' : 'error'} sx={{ mb: 2 }}>
          {error.includes('lock') || error.includes('Lock') ? (
            <><LockIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
            REAPI is already locked — leads are being served from the database. Use <strong>Remove Lock</strong> to allow a fresh seed.</>
          ) : error}
        </Alert>
      )}

      {result && (
        <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2 }}>
          <Typography gutterBottom sx={{ fontWeight: 700 }}>{result.message}</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
            <Chip label={`Engine 1: ${result.engine1} leads`} size="small" color="success" variant="outlined" />
            <Chip label={`Engine 2: ${result.engine2} leads`} size="small" color="info" variant="outlined" />
            <Chip label={`Enriched: ${result.enriched}`} size="small" />
            <Chip label={`DB Total: ${result.dbTotal}`} size="small" color="primary" />
            <Chip icon={<LockIcon />} label="REAPI Locked" size="small" color="warning" />
          </Stack>
        </Alert>
      )}

      <Divider sx={{ my: 3 }} />

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'warning.50' }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start' }} spacing={1}>
          <LockIcon color="warning" fontSize="small" sx={{ mt: 0.2 }} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Lock Behavior</Typography>
            <Typography variant="body2" color="text.secondary">
              After seeding, <code>api_seeded = true</code> is written to the <code>AppConfig</code> table in Neon.
              Every <code>GET /api/leads</code> request checks this flag first — if locked, it serves from DB without touching the REAPI.
              Use <strong>Remove Lock</strong> above only when you want to replace all leads with a fresh REAPI pull.
            </Typography>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
