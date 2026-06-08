'use client';

import React from 'react';
import { Box, Chip, Tooltip, Stack } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpIcon from '@mui/icons-material/Help';

type EligibilityStatus = 'eligible' | 'ineligible' | 'review' | null | undefined;

function statusConfig(status: EligibilityStatus) {
  switch (status) {
    case 'eligible':
      return { color: '#1b5e20', bg: '#c8e6c9', border: '#388e3c', icon: <CheckCircleIcon sx={{ fontSize: '0.9rem' }} />, label: 'Eligible' };
    case 'review':
      return { color: '#e65100', bg: '#fff3e0', border: '#f57c00', icon: <HelpIcon sx={{ fontSize: '0.9rem' }} />, label: 'Review' };
    case 'ineligible':
      return { color: '#b71c1c', bg: '#ffebee', border: '#e53935', icon: <CancelIcon sx={{ fontSize: '0.9rem' }} />, label: 'Ineligible' };
    default:
      return { color: '#9e9e9e', bg: '#f5f5f5', border: '#bdbdbd', icon: <HelpIcon sx={{ fontSize: '0.9rem' }} />, label: 'Unknown' };
  }
}

interface CarrierBadgeProps {
  carrier: 'Travelers' | 'Plymouth Rock';
  status: EligibilityStatus;
  notes?: string; // JSON array string
  size?: 'small' | 'medium';
}

function CarrierChip({ carrier, status, notes, size = 'small' }: CarrierBadgeProps) {
  const cfg = statusConfig(status);
  const shortName = carrier === 'Travelers' ? 'TRV' : 'PLY';

  let tooltipContent = `${carrier}: ${cfg.label}`;
  if (notes) {
    try {
      const parsed: string[] = JSON.parse(notes);
      if (parsed.length > 0) tooltipContent = `${carrier}: ${parsed.join(' • ')}`;
    } catch {}
  }

  return (
    <Tooltip title={tooltipContent} arrow>
      <Chip
        icon={cfg.icon as any}
        label={`${shortName}`}
        size="small"
        sx={{
          backgroundColor: cfg.bg,
          color: cfg.color,
          border: `1px solid ${cfg.border}`,
          fontWeight: 'bold',
          fontSize: '0.7rem',
          height: size === 'small' ? 22 : 28,
          '& .MuiChip-icon': { color: cfg.color },
        }}
      />
    </Tooltip>
  );
}

interface CarrierEligibilityBadgeProps {
  travelersEligible?: EligibilityStatus;
  travelersNotes?: string;
  plymouthEligible?: EligibilityStatus;
  plymouthNotes?: string;
  size?: 'small' | 'medium';
}

export default function CarrierEligibilityBadge({
  travelersEligible,
  travelersNotes,
  plymouthEligible,
  plymouthNotes,
  size = 'small',
}: CarrierEligibilityBadgeProps) {
  return (
    <Stack direction="row" spacing={0.5}>
      <CarrierChip carrier="Travelers" status={travelersEligible} notes={travelersNotes} size={size} />
      <CarrierChip carrier="Plymouth Rock" status={plymouthEligible} notes={plymouthNotes} size={size} />
    </Stack>
  );
}
