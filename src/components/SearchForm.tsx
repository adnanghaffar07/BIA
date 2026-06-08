'use client';

import React, { useState } from 'react';
import {
  Box, TextField, Button, Paper, Typography,
  ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AllInboxIcon from '@mui/icons-material/AllInbox';

interface SearchFormProps {
  onSearch: (filters: {
    size?: number;
    engine?: 1 | 2 | undefined;
  }) => void;
  loading?: boolean;
}

export default function SearchForm({ onSearch, loading = false }: SearchFormProps) {
  const [size, setSize] = useState('20');
  const [engine, setEngine] = useState<'all' | '1' | '2'>('all');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch({
      size: size ? parseInt(size) : 20,
      engine: engine === 'all' ? undefined : (parseInt(engine) as 1 | 2),
    });
  };

  const handleReset = () => {
    setSize('20');
    setEngine('all');
    onSearch({});
  };

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <form onSubmit={handleSubmit}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-end' }}>

          {/* Pipeline Engine Selector */}
          <Box sx={{ flex: 1, minWidth: 280 }}>
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}>
              Pipeline Engine (mortgage date filter)
            </Typography>
            <ToggleButtonGroup
              value={engine}
              exclusive
              onChange={(_e, v) => { if (v) setEngine(v); }}
              size="small"
              fullWidth
            >
              <Tooltip title="All NJ properties (no date filter)">
                <ToggleButton value="all">
                  <AllInboxIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> All
                </ToggleButton>
              </Tooltip>
              <Tooltip title="Engine 1 — First mortgage recorded within last 90 days (new purchase, highest priority)">
                <ToggleButton value="1" sx={{ '&.Mui-selected': { backgroundColor: '#e8f5e9', color: '#1b5e20' } }}>
                  <HomeWorkIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> New Purchase
                </ToggleButton>
              </Tooltip>
              <Tooltip title="Engine 2 — First mortgage recorded 2022–2025 (renewal/win-back targets)">
                <ToggleButton value="2" sx={{ '&.Mui-selected': { backgroundColor: '#fff3e0', color: '#e65100' } }}>
                  <AutorenewIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> Renewal
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>
          </Box>

          {/* Results per page */}
          <Box sx={{ minWidth: 140 }}>
            <TextField
              fullWidth
              label="Records to fetch"
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              variant="outlined"
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
              helperText="1–100"
            />
          </Box>

          {/* Action buttons */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button type="submit" variant="contained" disabled={loading} sx={{ minWidth: 130 }}>
              {loading ? 'Searching…' : 'Fetch Leads'}
            </Button>
            <Button type="button" variant="outlined" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
          </Box>
        </Box>

        {/* Engine description */}
        {engine !== 'all' && (
          <Box sx={{ mt: 1.5, p: 1.5, backgroundColor: engine === '1' ? '#f1f8e9' : '#fff8e1', borderRadius: 1, border: `1px solid ${engine === '1' ? '#a5d6a7' : '#ffe082'}` }}>
            <Typography variant="caption" color={engine === '1' ? '#2e7d32' : '#e65100'}>
              {engine === '1'
                ? '🏠 Engine 1 — Fetching properties where the first mortgage was recorded in the last 90 days. These homeowners are actively shopping for insurance.'
                : '🔄 Engine 2 — Fetching properties where the first mortgage was recorded between 2022 and 90 days ago. Targeting ~90 days before policy renewal.'}
            </Typography>
          </Box>
        )}
      </form>
    </Paper>
  );
}
