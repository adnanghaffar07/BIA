'use client';

import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  MenuItem,
  Paper,
} from '@mui/material';
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS, LAND_USE_TYPES } from '@/lib/constants';

interface SearchFormProps {
  onSearch: (filters: {
    propertyType?: string;
    landUse?: string;
    minBedrooms?: number;
    minBathrooms?: number;
    minValue?: number;
    maxValue?: number;
    investorBuyer?: boolean;
    highEquity?: boolean;
    preForeclosure?: boolean;
    size?: number;
  }) => void;
  loading?: boolean;
}

export default function SearchForm({ onSearch, loading = false }: SearchFormProps) {
  const [propertyType, setPropertyType] = useState('');
  const [landUse, setLandUse] = useState('');
  const [minBedrooms, setMinBedrooms] = useState('');
  const [minBathrooms, setMinBathrooms] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [investorOnly, setInvestorOnly] = useState(false);
  const [highEquityOnly, setHighEquityOnly] = useState(false);
  const [preForeclosureOnly, setPreForeclosureOnly] = useState(false);
  const [size, setSize] = useState('20');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch({
      size: size ? parseInt(size) : 20,
    });
  };

  const handleReset = () => {
    setSize('20');
    onSearch({});
  };

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <form onSubmit={handleSubmit}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
            mb: 2,
          }}
        >
          <Box>
            <TextField
              fullWidth
              label="Results Per Page"
              type="number"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              variant="outlined"
              size="small"
              slotProps={{
                htmlInput: { min: 1, max: 100 },
              }}
              helperText="1-100"
            />
          </Box>
        </Box>

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ flex: 1 }}
          >
            Search Properties
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={handleReset}
            disabled={loading}
            sx={{ flex: 1 }}
          >
            Reset
          </Button>
        </Box>
      </form>
    </Paper>
  );
}
