'use client';

import React from 'react';
import { Stack, Chip, Typography, Tooltip } from '@mui/material';

/**
 * The merge fields a sequence can use, as draggable chips.
 *
 * ── Why drag works without any drop handler ───────────────────────────────────
 * Each chip puts its token on the drag as `text/plain`. Browsers already know how to
 * drop plain text into a textarea or input: they insert it AT THE DROP POINT and fire
 * a native `input` event, which React's controlled onChange picks up. Writing our own
 * drop handler would mean computing a caret offset from an (x, y) coordinate, which is
 * fiddly, wrong at line wraps, and worse than what the browser already does.
 *
 * Clicking a chip does the same job for anyone not using a mouse — and for the common
 * case of wanting the token at the end of what you just typed, a click is faster than a
 * drag. Both routes exist because neither covers everything.
 */

export type MergeField = { token: string; label: string; example: string };

export const MERGE_FIELDS: MergeField[] = [
  { token: '{{firstName}}', label: 'First name', example: 'Trisha' },
  { token: '{{lastName}}', label: 'Last name', example: 'Mcnamara' },
  { token: '{{property_address}}', label: 'Property address', example: '83 Augustus Dr' },
  { token: '{{renewal_date}}', label: 'Renewal date', example: '2026-10-06' },
];

export default function MergeFieldPalette({
  onInsert,
}: {
  /** Click-to-insert. Drag is handled natively by the browser and never reaches here. */
  onInsert: (token: string) => void;
}) {
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Typography variant="caption" color="text.secondary">
        Drag into the subject or body, or click to insert:
      </Typography>
      {MERGE_FIELDS.map((f) => (
        <Tooltip key={f.token} title={`${f.token} — e.g. ${f.example}`}>
          <Chip
            size="small"
            label={f.label}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', f.token);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            // Keeps focus in the field being edited: without this the chip takes focus
            // on mousedown, and by the time the click fires there is no caret left to
            // insert at. Tracking focus separately would work too, but it depends on
            // focus events firing, which is exactly the kind of thing that breaks
            // quietly. Not stealing the focus in the first place has nothing to go wrong.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(f.token)}
            sx={{
              cursor: 'grab',
              fontWeight: 600,
              bgcolor: '#e8f0fe',
              color: '#1a56c4',
              '&:active': { cursor: 'grabbing' },
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}
