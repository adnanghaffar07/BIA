'use client';

import React from 'react';
import { Stack, Chip, Typography, Tooltip, Box } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import { MERGE_FIELDS, MERGE_FIELD_GROUPS, type MergeField } from '@/lib/mergeFields';

/**
 * The merge fields a sequence can use, as draggable chips.
 *
 * ── Why every field is here, including the ones that do not work ──────────────
 * This offered four chips while the system was building twenty-three variables. The other
 * nineteen existed, were mapped on the import, and were invisible to whoever was writing
 * the copy — so the only way to use them was to type the name from memory, and a name
 * typed from memory that is slightly wrong renders as nothing at all. Silently. In a
 * homeowner's inbox.
 *
 * The list now comes from `@/lib/mergeFields`, which is also what the editor validates
 * against, so the palette cannot show one set of names while the validator accepts another.
 *
 * Fields that are valid but currently render empty — the booking link, the price band —
 * are shown greyed WITH THE REASON rather than left out. A chip that is simply absent
 * reads as an oversight and gets typed by hand; a chip that says "waiting on Frank" does
 * not.
 *
 * ── Why drag works without any drop handler here ──────────────────────────────
 * Each chip puts its token on the drag as `text/plain`. Browsers already know how to drop
 * plain text into a textarea: they insert it AT THE DROP POINT and fire a native `input`
 * event, which React's controlled onChange picks up. The editor intercepts our own tokens
 * so the behaviour is testable, and anything else falls through to the browser, so ordinary
 * drag-and-drop of a sentence still behaves normally.
 *
 * Clicking a chip does the same job for anyone not using a mouse — and for the common case
 * of wanting the token at the end of what you just typed, a click is faster than a drag.
 * Both routes exist because neither covers everything.
 */

export type { MergeField };
export { MERGE_FIELDS };

function FieldChip({ f, onInsert }: { f: MergeField; onInsert: (token: string) => void }) {
  const blocked = Boolean(f.blocked);
  return (
    <Tooltip
      title={
        blocked
          ? `${f.token} — not usable yet. ${f.blocked}`
          : `${f.token} — e.g. ${f.example}`
      }
    >
      {/* A disabled Chip does not fire the events Tooltip listens for, so the span carries them. */}
      <span>
        <Chip
          size="small"
          label={f.label}
          icon={blocked ? <BlockIcon sx={{ fontSize: 14 }} /> : undefined}
          draggable={!blocked}
          onDragStart={(e) => {
            if (blocked) { e.preventDefault(); return; }
            e.dataTransfer.setData('text/plain', f.token);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          // Keeps focus in the field being edited: without this the chip takes focus on
          // mousedown, and by the time the click fires there is no caret left to insert at.
          // Tracking focus separately would work too, but it depends on focus events firing,
          // which is exactly the kind of thing that breaks quietly. Not stealing the focus in
          // the first place has nothing to go wrong.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (!blocked) onInsert(f.token); }}
          sx={{
            cursor: blocked ? 'not-allowed' : 'grab',
            fontWeight: 600,
            bgcolor: blocked ? '#f1f3f4' : '#e8f0fe',
            color: blocked ? '#9aa0a6' : '#1a56c4',
            '& .MuiChip-icon': { color: '#9aa0a6' },
            '&:active': { cursor: blocked ? 'not-allowed' : 'grabbing' },
          }}
        />
      </span>
    </Tooltip>
  );
}

export default function MergeFieldPalette({
  onInsert,
}: {
  /** Click-to-insert. Drag is handled by the editor so it stays testable. */
  onInsert: (token: string) => void;
}) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="caption" color="text.secondary">
        Drag into the subject or body, or click to insert. These are the only variables that
        exist — anything else renders as blank text in the email, so the editor will not save it.
      </Typography>

      {MERGE_FIELD_GROUPS.map((g) => {
        const fields = MERGE_FIELDS.filter((f) => f.group === g.key);
        if (!fields.length) return null;
        return (
          <Box key={g.key}>
            <Typography
              variant="caption"
              sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mb: 0.25 }}
            >
              {g.title}
            </Typography>
            {g.hint && (
              <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mb: 0.5 }}>
                {g.hint}
              </Typography>
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {fields.map((f) => <FieldChip key={f.name} f={f} onInsert={onInsert} />)}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
