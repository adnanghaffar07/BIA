'use client';

import React, { useEffect, useState } from 'react';
import {
  Container,
  Box,
  Alert,
  CircularProgress,
  Typography,
  Snackbar,
} from '@mui/material';
import SearchForm from '@/components/SearchForm';
import LeadsTable from '@/components/LeadsTable';
import { Lead, LeadFilters } from '@/types/lead';
import LeadService from '@/services/lead.service';
import { ERROR_MESSAGES } from '@/lib/constants';

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [payload, setPayload] = useState<any>(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error' | 'warning' | 'info',
  });

  // Fetch properties on component mount
  useEffect(() => {
    fetchProperties(filters);
  }, []);

  const fetchProperties = async (currentFilters: LeadFilters) => {
    try {
      setLoading(true);
      setError(null);

      // Build request payload
      const requestPayload = {
        ids_only: false,
        obfuscate: false,
        summary: false,
        size: currentFilters.size || 20,
      };
      
      setPayload(requestPayload);
      console.log('🚀 Fetching properties with payload:', requestPayload);

      // Call API with payload - pass size as query parameter
      const apiUrl = new URL('/api/leads', typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
      apiUrl.searchParams.append('size', requestPayload.size.toString());

      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch properties');
      }

      const result = await response.json();
      
      if (result.success) {
        let properties = result.data || [];

        // Apply filters
        if (currentFilters.propertyType) {
          properties = LeadService.filterProperties(
            properties,
            (prop) => prop.propertyType === currentFilters.propertyType
          );
        }

        if (currentFilters.landUse) {
          properties = LeadService.filterProperties(
            properties,
            (prop) => prop.landUse === currentFilters.landUse
          );
        }

        if (currentFilters.minBedrooms) {
          properties = LeadService.filterByMinBedrooms(
            properties,
            currentFilters.minBedrooms
          );
        }

        if (currentFilters.minBathrooms) {
          properties = LeadService.filterByMinBathrooms(
            properties,
            currentFilters.minBathrooms
          );
        }

        if (currentFilters.minValue || currentFilters.maxValue) {
          properties = LeadService.filterByValueRange(
            properties,
            currentFilters.minValue,
            currentFilters.maxValue
          );
        }

        if (currentFilters.investorBuyer) {
          properties = LeadService.filterInvestorProperties(properties);
        }

        if (currentFilters.highEquity) {
          properties = LeadService.filterHighEquityProperties(properties);
        }

        if (currentFilters.preForeclosure) {
          properties = LeadService.filterPreForeclosureProperties(properties);
        }

        setLeads(properties);
      } else {
        throw new Error(result.error || 'Failed to fetch properties');
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : ERROR_MESSAGES.FETCH_LEADS_FAILED;
      setError(errorMessage);
      showSnackbar(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (newFilters: LeadFilters) => {
    setFilters(newFilters);
    // Pass filters directly to fetchProperties instead of relying on state
    fetchProperties(newFilters);
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to delete this property record?'
      )
    ) {
      return;
    }

    try {
      // TODO: Implement delete when API supports it
      setLeads(leads.filter((lead) => lead.id !== id));
      showSnackbar('Property record deleted successfully', 'success');
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : ERROR_MESSAGES.DELETE_LEAD_FAILED;
      showSnackbar(errorMessage, 'error');
    }
  };

  const showSnackbar = (
    message: string,
    severity: 'success' | 'error' | 'warning' | 'info'
  ) => {
    setSnackbar({
      open: true,
      message,
      severity,
    });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ mb: 2, fontWeight: 'bold' }}>
          🏘️ Property Search
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Search and browse properties from the Real Estate API
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* {payload && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
            📤 Last Request Payload:
          </Typography>
          <Box
            component="pre"
            sx={{
              backgroundColor: '#f5f5f5',
              p: 1.5,
              borderRadius: 1,
              fontSize: '0.75rem',
              overflow: 'auto',
              maxHeight: '200px',
            }}
          >
            {JSON.stringify(payload, null, 2)}
          </Box>
          <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
            ℹ️ Check the browser console for full request/response logs
          </Typography>
        </Alert>
      )} */}

      <SearchForm onSearch={handleSearch} loading={loading} />

      {loading && !leads.length ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <LeadsTable
          leads={leads}
          loading={loading}
          fetchSize={filters.size ?? 20}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
