'use client';

import React from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Box,
  Chip,
  Stack,
} from '@mui/material';
import { Lead } from '@/types/lead';
import { formatCurrency } from '@/utils/formatAddress';
import { LEAD_STATUS_OPTIONS } from '@/lib/constants';

interface LeadCardProps {
  lead: Lead;
  onView?: (lead: Lead) => void;
  onEdit?: (lead: Lead) => void;
  onDelete?: (id: string) => void;
}

export default function LeadCard({
  lead,
  onView,
  onEdit,
  onDelete,
}: LeadCardProps) {
  const statusOption = LEAD_STATUS_OPTIONS.find((s) => s.value === lead.status);

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6" component="div">
            {lead.address?.street}
          </Typography>
          {statusOption && (
            <Chip
              label={statusOption.label}
              size="small"
              color={statusOption.color as any}
              variant="filled"
            />
          )}
        </Box>

        <Stack spacing={1} sx={{ mb: 2 }}>
          <Typography variant="body2" color="textSecondary">
            <strong>Address:</strong> {lead.address?.city}, {lead.address?.state} {lead.address?.zip}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>County:</strong> {lead.address?.county}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Property Type:</strong> {lead.propertyType || lead.propertyUse}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Bedrooms:</strong> {lead.bedrooms || '-'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Bathrooms:</strong> {lead.bathrooms || '-'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Sq Ft:</strong> {lead.squareFeet ? lead.squareFeet.toLocaleString() : '-'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Est. Value:</strong> {lead.estimatedValue ? formatCurrency(lead.estimatedValue) : '-'}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Year Built:</strong> {lead.yearBuilt || '-'}
          </Typography>
          {lead.highEquity && (
            <Chip label="High Equity" size="small" color="success" variant="outlined" />
          )}
          {lead.investorBuyer && (
            <Chip label="Investor Buyer" size="small" color="primary" variant="outlined" />
          )}
          {lead.preForeclosure && (
            <Chip label="Pre-Foreclosure" size="small" color="warning" variant="outlined" />
          )}
        </Stack>
      </CardContent>

      <CardActions>
        {onView && (
          <Button size="small" onClick={() => onView(lead)}>
            View
          </Button>
        )}
        {onEdit && (
          <Button size="small" onClick={() => onEdit(lead)}>
            Edit
          </Button>
        )}
        {onDelete && (
          <Button
            size="small"
            color="error"
            onClick={() => onDelete(lead.id)}
          >
            Delete
          </Button>
        )}
      </CardActions>
    </Card>
  );
}
