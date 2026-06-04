'use client';

import React from 'react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { LeadGrade, GRADE_INFO } from '@/types/grade';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import BlockIcon from '@mui/icons-material/Block';

interface LeadGradeBadgeProps {
  grade: LeadGrade;
  size?: 'small' | 'medium';
  showLabel?: boolean;
}

const GRADE_ICONS: Record<LeadGrade, React.ReactNode> = {
  A: <CheckCircleIcon sx={{ fontSize: '1.2rem' }} />,
  B: <WarningIcon sx={{ fontSize: '1.2rem' }} />,
  C: <ErrorIcon sx={{ fontSize: '1.2rem' }} />,
  D: <BlockIcon sx={{ fontSize: '1.2rem' }} />,
};

export default function LeadGradeBadge({ grade, size = 'medium', showLabel = true }: LeadGradeBadgeProps) {
  const gradeInfo = GRADE_INFO[grade];

  return (
    <Tooltip title={gradeInfo.description} arrow>
      <Chip
        icon={GRADE_ICONS[grade] as any}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontWeight: 'bold', fontSize: size === 'small' ? '0.75rem' : '0.9rem' }}>
              {grade}
            </Typography>
            {showLabel && (
              <Typography sx={{ fontSize: size === 'small' ? '0.65rem' : '0.8rem', ml: 0.5 }}>
                {gradeInfo.label}
              </Typography>
            )}
          </Box>
        }
        sx={{
          backgroundColor: gradeInfo.backgroundColor,
          color: gradeInfo.color,
          borderColor: gradeInfo.borderColor,
          border: '2px solid',
          fontWeight: 'bold',
          '& .MuiChip-icon': {
            color: gradeInfo.color,
          },
        }}
        size={size === 'small' ? 'small' : 'medium'}
      />
    </Tooltip>
  );
}
