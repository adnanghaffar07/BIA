'use client';

import React from 'react';
import { Box, Typography, Chip, Stack, Divider } from '@mui/material';
import { Lead } from '@/types/lead';
import { formatCurrency } from '@/utils/formatAddress';

interface PropertyDetailsContentProps {
  property: Lead;
}

export default function PropertyDetailsContent({
  property,
}: PropertyDetailsContentProps) {
  const renderField = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    let displayValue: string | number = value as string | number;
    if (typeof value === 'number' && label.toLowerCase().includes('value')) {
      displayValue = formatCurrency(value);
    } else if (
      typeof value === 'number' &&
      label.toLowerCase().includes('sq ft')
    ) {
      displayValue = value.toLocaleString();
    } else if (typeof value === 'boolean') {
      displayValue = value ? 'Yes' : 'No';
    }

    return (
      <Box key={label} sx={{ mb: 1.5 }}>
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ fontWeight: 'bold' }}
        >
          {label}
        </Typography>
        <Typography variant="body2">{displayValue}</Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ py: 2, px: 1 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Address Information
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {renderField('Street', property.address?.street)}
          {renderField('City', property.address?.city)}
          {renderField('State', property.address?.state)}
          {renderField('ZIP Code', property.address?.zip)}
          {renderField('County', property.address?.county)}
          {renderField('Full Address', property.address?.address)}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Property Details
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {renderField('Property Type', property.propertyType)}
          {renderField('Property Use', property.propertyUse)}
          {renderField('Land Use', property.landUse)}
          {renderField('Bedrooms', property.bedrooms)}
          {renderField('Bathrooms', property.bathrooms)}
          {renderField('Square Feet', property.squareFeet)}
          {renderField('Year Built', property.yearBuilt)}
          {renderField('Lot Sq Ft', property.lotSquareFeet)}
          {renderField('Stories', property.stories)}
          {renderField('Units', property.unitsCount)}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Financial Information
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {renderField('Estimated Value', property.estimatedValue)}
          {renderField('Assessed Value', property.assessedValue)}
          {renderField('Assessed Land Value', property.assessedLandValue)}
          {renderField(
            'Assessed Improvement Value',
            property.assessedImprovementValue
          )}
          {renderField('Estimated Equity', property.estimatedEquity)}
          {renderField('Suggested Rent', property.suggestedRent)}
          {renderField('Last Sale Amount', property.lastSaleAmount)}
          {renderField('Last Sale Date', property.lastSaleDate)}
          {renderField('Open Mortgage Balance', property.openMortgageBalance)}
          {renderField('Lender Name', property.lenderName)}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Owner Information
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {renderField('Owner Name', property.owner1LastName)}
          {renderField('Company Name', property.companyName)}
          {renderField('Owner Occupied', property.ownerOccupied)}
          {renderField('Corporate Owned', property.corporateOwned)}
          {renderField('Absentee Owner', property.absenteeOwner)}
          {renderField('Investor Buyer', property.investorBuyer)}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Amenities & Features
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {property.garage && (
            <Chip label="Garage" size="small" variant="outlined" />
          )}
          {property.pool && <Chip label="Pool" size="small" variant="outlined" />}
          {property.deck && <Chip label="Deck" size="small" variant="outlined" />}
          {property.patio && (
            <Chip label="Patio" size="small" variant="outlined" />
          )}
          {property.basement && (
            <Chip label="Basement" size="small" variant="outlined" />
          )}
          {property.airConditioningAvailable && (
            <Chip label="Air Conditioning" size="small" variant="outlined" />
          )}
          {!property.garage &&
            !property.pool &&
            !property.deck &&
            !property.patio &&
            !property.basement &&
            !property.airConditioningAvailable && (
              <Typography variant="body2" color="textSecondary">
                None listed
              </Typography>
            )}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Property Conditions
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {property.vacant && (
            <Chip label="Vacant" size="small" color="warning" variant="filled" />
          )}
          {property.preForeclosure && (
            <Chip
              label="Pre-Foreclosure"
              size="small"
              color="error"
              variant="filled"
            />
          )}
          {property.foreclosure && (
            <Chip label="Foreclosure" size="small" color="error" variant="filled" />
          )}
          {property.highEquity && (
            <Chip
              label="High Equity"
              size="small"
              color="success"
              variant="filled"
            />
          )}
          {property.investorBuyer && (
            <Chip
              label="Investor Property"
              size="small"
              color="primary"
              variant="filled"
            />
          )}
          {property.floodZone && (
            <Chip label="Flood Zone" size="small" color="warning" variant="filled" />
          )}
          {property.hoa && <Chip label="HOA" size="small" variant="outlined" />}
          {property.reo && (
            <Chip label="REO" size="small" color="error" variant="outlined" />
          )}
        </Box>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ mb: property.latitude && property.longitude ? 3 : 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
          Tax & Legal Information
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
          }}
        >
          {renderField('APN', property.apn)}
          {renderField('FIPS Code', property.fips)}
          {renderField('Parcel Account', property.parcelAccountNumber)}
          {renderField('Document Type', property.documentType)}
          {renderField('Recording Date', property.recordingDate)}
          {renderField('Last Update', property.lastUpdateDate)}
        </Box>
      </Box>

      {property.latitude != null && property.longitude != null && (
        <>
          <Divider sx={{ my: 2 }} />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
              Coordinates
            </Typography>
            <Stack direction="row" spacing={4}>
              {renderField('Latitude', property.latitude.toFixed(6))}
              {renderField('Longitude', property.longitude.toFixed(6))}
            </Stack>
          </Box>
        </>
      )}

      {property.notes && (
        <>
          <Divider sx={{ my: 2 }} />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
              Notes
            </Typography>
            <Typography variant="body2">{property.notes}</Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
