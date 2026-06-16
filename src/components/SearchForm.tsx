'use client';

import React, { useState } from 'react';
import {
  Box, TextField, Button, Paper, Typography,
  ToggleButton, ToggleButtonGroup, Tooltip,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import AllInboxIcon from '@mui/icons-material/AllInbox';
import FilterListIcon from '@mui/icons-material/FilterList';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { LeadFilters, LeadGradeValue, LeadStatus } from '@/types/lead';

interface SearchFormProps {
  onSearch: (filters: LeadFilters) => void;
  loading?: boolean;
}

const GRADE_OPTIONS = [
  { value: '', label: 'All Grades' },
  { value: 'A', label: 'A — Quote Ready' },
  { value: 'B', label: 'B — Almost Ready' },
  { value: 'C', label: 'C — Needs Info' },
  { value: 'D', label: 'D — Disqualified' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'quote_sent', label: 'Quote Sent' },
  { value: 'bound', label: 'Bound' },
  { value: 'lost', label: 'Lost' },
];

export default function SearchForm({ onSearch, loading = false }: SearchFormProps) {
  const [size, setSize] = useState('100');
  const [engine, setEngine] = useState<'all' | '1' | '2'>('all');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch({
      size: size ? parseInt(size) : 100,
      engine: engine === 'all' ? undefined : (parseInt(engine) as 1 | 2),
      grade: (grade || undefined) as LeadGradeValue | undefined,
      status: (status || undefined) as LeadStatus | undefined,
    });
  };

  const handleReset = () => {
    setSize('100');
    setEngine('all');
    setGrade('');
    setStatus('');
    onSearch({});
  };

  const hasActiveFilters = engine !== 'all' || grade !== '' || status !== '';

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <form onSubmit={handleSubmit}>
        {/* Row 1: Pipeline engine toggle */}
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 0.5, fontWeight: 500 }}>
            Pipeline Engine (mortgage date filter)
          </Typography>
          <ToggleButtonGroup
            value={engine}
            exclusive
            onChange={(_e, v) => { if (v) setEngine(v); }}
            size="small"
          >
            <Tooltip title="All leads — no date filter">
              <ToggleButton value="all">
                <AllInboxIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> All
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Engine 1 — first mortgage within last 90 days">
              <ToggleButton value="1" sx={{ '&.Mui-selected': { backgroundColor: '#e8f5e9', color: '#1b5e20' } }}>
                <HomeWorkIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> New Purchase
              </ToggleButton>
            </Tooltip>
            <Tooltip title="Engine 2 — mortgage from 2022–2025">
              <ToggleButton value="2" sx={{ '&.Mui-selected': { backgroundColor: '#fff3e0', color: '#e65100' } }}>
                <AutorenewIcon sx={{ mr: 0.5, fontSize: '1rem' }} /> Renewal
              </ToggleButton>
            </Tooltip>
          </ToggleButtonGroup>
        </Box>

        {/* Row 2: Grade, Status, Size, Buttons */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>

          {/* Grade filter */}
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Grade</InputLabel>
            <Select
              value={grade}
              label="Grade"
              onChange={(e) => setGrade(e.target.value)}
            >
              {GRADE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.value && (
                    <Box component="span" sx={{
                      display: 'inline-block', width: 18, height: 18, borderRadius: '50%',
                      mr: 1, verticalAlign: 'middle', fontSize: 11, lineHeight: '18px',
                      textAlign: 'center', fontWeight: 700, color: '#fff',
                      backgroundColor: o.value === 'A' ? '#2e7d32' : o.value === 'B' ? '#1565c0' : o.value === 'C' ? '#e65100' : '#757575',
                    }}>{o.value}</Box>
                  )}
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Status filter */}
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={status}
              label="Status"
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Size */}
          <TextField
            label="Show leads"
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            variant="outlined"
            size="small"
            sx={{ width: 120 }}
            slotProps={{ htmlInput: { min: 1, max: 100 } }}
            helperText="1–100"
          />

          {/* Buttons */}
          <Box sx={{ display: 'flex', gap: 1, pt: 0.25 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={loading}
              startIcon={<FilterListIcon />}
              sx={{ minWidth: 130 }}
            >
              {loading ? 'Loading…' : 'Apply Filters'}
            </Button>
            <Button
              type="button"
              variant="outlined"
              onClick={handleReset}
              disabled={loading}
              startIcon={<RestartAltIcon />}
              color={hasActiveFilters ? 'warning' : 'inherit'}
            >
              Reset{hasActiveFilters ? ' ●' : ''}
            </Button>
          </Box>
        </Box>

        {/* Active filter hint */}
        {(engine !== 'all' || grade || status) && (
          <Box sx={{ mt: 1.5, p: 1, backgroundColor: '#f0f4ff', borderRadius: 1, border: '1px solid #c5cae9' }}>
            <Typography variant="caption" color="primary">
              Filters active:
              {engine !== 'all' && <strong> Engine {engine}</strong>}
              {grade && <strong> · Grade {grade}</strong>}
              {status && <strong> · Status: {STATUS_OPTIONS.find(o => o.value === status)?.label}</strong>}
            </Typography>
          </Box>
        )}
      </form>
    </Paper>
  );
}
