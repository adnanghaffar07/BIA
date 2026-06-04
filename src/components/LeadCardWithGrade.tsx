'use client';

import React from 'react';
import { Box, Card, CardContent, Grid, Typography, LinearProgress, Chip, Stack } from '@mui/material';
import { Lead } from '@/types/lead';
import LeadGradeBadge from './LeadGradeBadge';
import { calculateLeadGrade, getMissingFields, getCompletenessPercentage } from '@/services/grade.service';
import { formatAddress } from '@/utils/formatAddress';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import HomeIcon from '@mui/icons-material/Home';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';

interface LeadCardWithGradeProps {
  lead: Lead;
  onClick?: () => void;
}

export default function LeadCardWithGrade({ lead, onClick }: LeadCardWithGradeProps) {
  const grade = calculateLeadGrade(lead);
  const missingFields = getMissingFields(lead);
  const completeness = getCompletenessPercentage(lead);

  return (
    <Card
      sx={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        '&:hover': onClick
          ? {
              boxShadow: 4,
              transform: 'translateY(-4px)',
            }
          : {},
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={onClick}
    >
      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        {/* Header with Grade Badge */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.5 }}>
              {lead.owner1LastName || 'Unknown Owner'}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {lead.propertyId}
            </Typography>
          </Box>
          <LeadGradeBadge grade={grade} size="small" showLabel={false} />
        </Box>

        {/* Address */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
          <LocationOnIcon sx={{ fontSize: '1rem', color: '#1976d2', mt: 0.3, flexShrink: 0 }} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {lead.address && formatAddress(lead.address)}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              {lead.propertyType}
            </Typography>
          </Box>
        </Box>

        {/* Property Info Grid */}
        <Grid container spacing={1} sx={{ mb: 2 }}>
          <Grid item xs={6}>
            <Box sx={{ p: 1, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }}>
                Estimated Value
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {lead.estimatedValue ? `$${(lead.estimatedValue / 1000).toFixed(0)}K` : 'N/A'}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={6}>
            <Box sx={{ p: 1, backgroundColor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }}>
                Year Built
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {lead.yearBuilt || 'N/A'}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        {/* Completeness Indicator */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
              Profile Complete
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#1976d2' }}>
              {completeness}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={completeness}
            sx={{
              height: 6,
              borderRadius: 1,
              backgroundColor: '#e0e0e0',
              '& .MuiLinearProgress-bar': {
                backgroundColor: completeness === 100 ? '#4caf50' : completeness >= 75 ? '#ff9800' : '#f44336',
              },
            }}
          />
        </Box>

        {/* Missing Fields */}
        {missingFields.length > 0 && (
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
              Missing Fields ({missingFields.length}):
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {missingFields.slice(0, 3).map((field) => (
                <Chip
                  key={field}
                  label={field.split('.').pop()}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontSize: '0.7rem',
                    height: 20,
                    backgroundColor: '#ffebee',
                    borderColor: '#ef5350',
                    color: '#c62828',
                  }}
                />
              ))}
              {missingFields.length > 3 && (
                <Typography variant="caption" sx={{ color: '#666', pl: 0.5, pt: 0.5 }}>
                  +{missingFields.length - 3} more
                </Typography>
              )}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
