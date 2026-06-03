'use client';

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { Lead } from '@/types/lead';
import PropertyDetailsContent from '@/components/PropertyDetailsContent';

interface PropertyDetailsDialogProps {
  open: boolean;
  property: Lead | null;
  onClose: () => void;
}

export default function PropertyDetailsDialog({
  open,
  property,
  onClose,
}: PropertyDetailsDialogProps) {
  if (!property) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', fontSize: '1.3rem' }}>
        {property.address?.street || 'Property Details'}
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <PropertyDetailsContent property={property} />
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="contained" fullWidth>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
