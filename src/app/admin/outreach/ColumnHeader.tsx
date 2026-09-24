'use client';

import React from 'react';
import { TableCell, Tooltip, Box } from '@mui/material';

/**
 * A column header that explains itself.
 *
 * Frank reads this dashboard without anyone next to him, and a column called "Kept" or
 * "Inside at quote" is only obvious to whoever wrote it. Every header on every table
 * carries what the column is FOR and what it actually counts, so a question about a number
 * is answerable from the screen rather than by asking Abdullah.
 *
 * ── The hint has to be visible, or the tooltip may as well not exist ────────
 * A tooltip nobody knows is there is decoration. The header is drawn with a dotted
 * underline and a help cursor, which is the long-standing convention for "there is more
 * here", so the affordance is discoverable without a legend explaining the legend.
 *
 * ── Why the text lives with the column, not here ────────────────────────────
 * Each table passes its own `help`, kept beside the column's own definition. A central
 * dictionary of descriptions would drift from the columns it describes the first time one
 * was renamed — the same reason the CSV and the table read one list in this codebase.
 */
export default function ColumnHeader({
  label,
  help,
  align = 'left',
  width,
}: {
  label: string;
  help: string;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <TableCell
      align={align}
      sx={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', width }}
    >
      <Tooltip title={help} arrow enterDelay={200}>
        {/*
          A span, not the cell: the dotted underline should sit under the words rather than
          run the full width of the column, or a right-aligned numeric header grows a rule
          across empty space.
        */}
        <Box
          component="span"
          sx={{
            cursor: 'help',
            borderBottom: '1px dotted #9aa3ad',
            // The underline should not collide with the text's descenders.
            paddingBottom: '1px',
          }}
        >
          {label}
        </Box>
      </Tooltip>
    </TableCell>
  );
}
