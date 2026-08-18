'use client';

import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Chip, Stack, Divider, Link,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface SkipTraceDialogProps {
  open: boolean;
  onClose: () => void;
  data: any;
  tracedAt?: string;
}

function fmtPhone(p?: string): string {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p ?? '');
}

const PHONE_TYPE: Record<string, string> = {
  L: 'Landline', W: 'Wireless', M: 'Mobile', V: 'VOIP', C: 'Wireless',
};

function fmtAddress(a: any): string {
  if (!a || typeof a !== 'object') return '';
  if (a.address) return a.address;
  return [a.streetAddress ?? a.street, a.city, a.state, a.zip].filter(Boolean).join(', ');
}

/** camelCase / snake_case key → "Title Case" label. */
function humanize(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// Person fields rendered explicitly elsewhere (name, formatted contacts/addresses,
// and the header chips) — excluded from the generic "all other fields" grid.
const HANDLED_KEYS = new Set([
  // REAPI shape
  'phones', 'emails', 'address', 'previousAddress',
  'fullName', 'firstName', 'middleName', 'lastName',
  'age', 'gender', 'occupationDescription', 'maritalStatusDescription',
  // Tracerfy shape (snake_case) — rendered explicitly, kept out of the generic grid
  'full_name', 'first_name', 'last_name', 'mailing_address',
]);

export default function SkipTraceDialog({ open, onClose, data, tracedAt }: SkipTraceDialogProps) {
  const persons: any[] = Array.isArray(data?.persons) ? data.persons : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
        <PersonSearchIcon color="primary" />
        Skip Trace Results
        {data?.resultCount != null && (
          <Chip label={`${data.resultCount} match${data.resultCount === 1 ? '' : 'es'}`} size="small" color="primary" variant="outlined" />
        )}
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {persons.length === 0 ? (
          <Typography color="text.secondary">No matched persons returned for this lead.</Typography>
        ) : (
          <Stack spacing={2}>
            {persons.map((p, i) => {
              const name = p.full_name || p.fullName
                || [p.first_name ?? p.firstName, p.middleName, p.last_name ?? p.lastName].filter(Boolean).join(' ')
                || 'Unknown';
              const phones: any[] = Array.isArray(p.phones) ? p.phones : [];
              const emails: any[] = Array.isArray(p.emails) ? p.emails : [];
              // Every remaining scalar field, so nothing from the API is hidden.
              const otherFields = Object.entries(p).filter(
                ([k, v]) => !HANDLED_KEYS.has(k) && v != null && v !== '' && typeof v !== 'object',
              );
              return (
                <Box key={p.personId || i} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                  {/* Header: name + key demographics */}
                  <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }} spacing={1}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{name}</Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {p.age && <Chip size="small" variant="outlined" label={`Age ${p.age}`} />}
                      {p.gender && <Chip size="small" variant="outlined" label={p.gender === 'F' ? 'Female' : p.gender === 'M' ? 'Male' : p.gender} />}
                      {p.maritalStatusDescription && <Chip size="small" variant="outlined" label={p.maritalStatusDescription} />}
                      {p.occupationDescription && <Chip size="small" variant="outlined" label={p.occupationDescription} />}
                    </Stack>
                  </Stack>

                  <Divider sx={{ my: 1.5 }} />

                  {/* Phones */}
                  {phones.length > 0 && (
                    <Stack spacing={0.75} sx={{ mb: emails.length ? 1.5 : 0 }}>
                      {phones.map((ph, j) => {
                        const num = ph.number ?? ph.phone;                       // Tracerfy | REAPI
                        const type = ph.type ?? (ph.phoneType ? (PHONE_TYPE[ph.phoneType] ?? ph.phoneType) : undefined);
                        const dnc = ph.dnc ?? ph.phoneFtcDnc;
                        return (
                          <Stack key={j} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <PhoneIcon fontSize="small" color="action" />
                            <Link href={`tel:${String(num ?? '').replace(/\D/g, '')}`} sx={{ fontWeight: 600 }}>
                              {fmtPhone(num)}
                            </Link>
                            {type && <Chip size="small" variant="outlined" label={type} />}
                            {ph.carrier && <Chip size="small" variant="outlined" label={ph.carrier} />}
                            {dnc && <Chip size="small" color="error" label="DNC" title="On the Do-Not-Call registry" />}
                            {ph.tcpa && <Chip size="small" color="warning" label="TCPA" title="TCPA-flagged (litigation risk)" />}
                            {ph.rank && <Typography variant="caption" color="text.secondary">rank {ph.rank}</Typography>}
                            {ph.phoneLastSeen && (
                              <Typography variant="caption" color="text.secondary">last seen {ph.phoneLastSeen}</Typography>
                            )}
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}

                  {/* Emails */}
                  {emails.length > 0 && (
                    <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                      {emails.map((em, j) => {
                        const addr = typeof em === 'string' ? em : em?.email;
                        return (
                          <Stack key={j} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <EmailIcon fontSize="small" color="action" />
                            <Link href={`mailto:${addr}`}>{addr}</Link>
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}

                  {/* Addresses */}
                  {fmtAddress(p.address ?? p.mailing_address) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Address: {fmtAddress(p.address ?? p.mailing_address)}
                    </Typography>
                  )}
                  {fmtAddress(p.previousAddress) && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Previous: {fmtAddress(p.previousAddress)}
                    </Typography>
                  )}

                  {/* Every remaining field returned for this person */}
                  {otherFields.length > 0 && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2, rowGap: 0.25, mt: 1.5 }}>
                      {otherFields.map(([k, v]) => (
                        <Typography key={k} variant="caption" color="text.secondary">
                          <strong>{humanize(k)}:</strong> {String(v)}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}

        {/* Absolute completeness — the full raw API response, nothing omitted. */}
        {data && (
          <Accordion disableGutters sx={{ mt: 2, bgcolor: 'transparent' }} elevation={0} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>Full raw API response</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'grey.100', borderRadius: 1, fontSize: 11, lineHeight: 1.5, overflow: 'auto', maxHeight: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(data, null, 2)}
              </Box>
            </AccordionDetails>
          </Accordion>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          Source: Tracerfy Skip Trace{tracedAt ? ` · ${new Date(tracedAt).toLocaleString()}` : ''}. Verify DNC status before calling.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
