/**
 * Timezones the campaign platform accepts on a schedule.
 *
 * THIS FILE MUST HAVE NO IMPORTS. Client components need the list to render a
 * dropdown, and importing it from the API client would drag server-only code — and
 * the API key it reads — into the browser bundle.
 *
 * The platform does NOT take arbitrary IANA zones. It uses a curated list with one
 * representative zone per offset, and the representative is not always the obvious
 * one. Verified live, Sep-2026, by attempting a campaign create per candidate:
 *
 *     America/New_York              REJECTED
 *     America/Detroit               accepted   ← this is how you get Eastern
 *     America/Toronto               REJECTED
 *     EST5EDT                       REJECTED
 *     America/Indiana/Indianapolis  REJECTED
 *     America/Los_Angeles           REJECTED
 *     America/Dawson                accepted   ← this is how you get Pacific
 *     America/Denver                REJECTED
 *     America/Boise                 accepted   ← this is how you get Mountain
 *
 * So a New Jersey agency schedules on America/Detroit. Same offset, same DST rules,
 * different spelling — and sending "America/New_York" fails the create outright.
 */

export type CampaignTimezone = { value: string; label: string };

/** Every value here was accepted by a real create call. Ordered US-first. */
export const CAMPAIGN_TIMEZONES: CampaignTimezone[] = [
  { value: 'America/Detroit',    label: 'Eastern (US & Canada)' },
  { value: 'America/Chicago',    label: 'Central (US & Canada)' },
  { value: 'America/Boise',      label: 'Mountain (US & Canada)' },
  { value: 'America/Creston',    label: 'Mountain — no DST (Arizona)' },
  { value: 'America/Dawson',     label: 'Pacific (US & Canada)' },
  { value: 'America/Anchorage',  label: 'Alaska' },
  { value: 'America/St_Johns',   label: 'Newfoundland' },
  { value: 'America/Chihuahua',  label: 'Chihuahua, La Paz, Mazatlan' },
  { value: 'America/Belize',     label: 'Central America' },
  { value: 'America/Bogota',     label: 'Bogota, Lima, Quito' },
  { value: 'America/Sao_Paulo',  label: 'Brasilia' },
  { value: 'Asia/Kolkata',       label: 'India Standard Time' },
  { value: 'Etc/GMT+10',         label: 'UTC−10' },
  { value: 'Etc/GMT+11',         label: 'UTC−11' },
  { value: 'Etc/GMT+12',         label: 'UTC−12' },
];

/** What the agency operates on — the sensible default for every new campaign. */
export const DEFAULT_CAMPAIGN_TIMEZONE = 'America/Detroit';

/** Mon–Fri, the shape the platform expects (0 = Sunday). */
export const WEEKDAYS_ONLY: Record<string, boolean> = {
  '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false,
};

export const DAY_LABELS: Array<{ key: string; label: string }> = [
  { key: '0', label: 'Sun' }, { key: '1', label: 'Mon' }, { key: '2', label: 'Tue' },
  { key: '3', label: 'Wed' }, { key: '4', label: 'Thu' }, { key: '5', label: 'Fri' },
  { key: '6', label: 'Sat' },
];
