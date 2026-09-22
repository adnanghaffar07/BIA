/**
 * Is the owner of record a person, or an entity — a trust, a company, a municipality?
 *
 * Frank (Sep-2026): entity-owned properties must NEVER be skip traced, and must be shown
 * separately in the blast rather than silently dropped from it.
 *
 * ── Why it matters ──────────────────────────────────────────────────────────
 * The enhanced trace keys off the named insured. When the owner of record is
 * "Maybloom Family Trust" there is no natural person to look up, so the call bills and
 * returns nothing. Across the 9,937 leads held today, 695 are entity-owned (7%) and
 * exactly ONE has ever been traced — so this codifies what was already happening by
 * accident, and stops the credits being spent when it stops happening by accident.
 *
 * This is not a judgement that the lead is worthless. A trust is a perfectly ordinary
 * named insured on a NJ homeowners policy and the property has a real occupant. What is
 * true is narrower: the email-first outreach model has no person to address, and the
 * trace has no person to find. Those leads need a different route, which is why they get
 * their own section instead of a downgrade.
 *
 * ── Zero imports, deliberately ──────────────────────────────────────────────
 * This file is imported by both a server route and a client dialog. Importing a value
 * from a server module pulls its whole import graph into the browser bundle — that is
 * how NEXT_PUBLIC_REAL_ESTATE_API_KEY ended up inlined into client JS. Vocabulary lives
 * in src/lib with no dependencies so it can be shared without dragging anything along.
 *
 * ── The patterns were calibrated, not guessed ───────────────────────────────
 * Every token below was tested against all 9,579 distinct owner names in the live
 * database and the matches read by eye. Tokens that matched NOTHING (bank, church,
 * school, fbo, ltd, associates) were dropped rather than left in as false-positive
 * surface. `\btr\b` was the one worth checking hardest: all 32 matches are genuine
 * ("Rev Tr", "Liv Tr", "Irrevocable Tr", "Inter Vivos Tr"), none is a surname.
 *
 * `\bco\b` was deliberately NOT included. Four names match it, two of which are street
 * addresses sitting in the owner field, and "Gerrie Co" could be either. Two uncertain
 * gains are not worth burying one real homeowner in the excluded list.
 *
 * A false positive here is costly and quiet: a real owner stops being traced and stops
 * being mailed, with no error anywhere. That asymmetry is why this errs narrow — an
 * entity we fail to spot merely wastes 15 credits and shows up as a miss, which is
 * recoverable. Every exclusion carries the matched text so a wrong call is visible on
 * screen rather than buried in a count.
 */

export type EntityKind = 'trust' | 'company' | 'government' | 'estate';

export type OwnerEntity = {
  kind: EntityKind;
  /** The literal text that matched, for display: "Revocable Trust", "Llc", "Township". */
  matched: string;
  /** How it reads in the UI: "Trust", "Company", "Municipality", "Estate". */
  label: string;
};

const LABEL: Record<EntityKind, string> = {
  trust: 'Trust',
  company: 'Company',
  government: 'Municipality',
  estate: 'Estate',
};

/**
 * Ordered: the first match wins, so "Morgan Real Estate Trust" reads as a trust rather
 * than an estate, and "Rbc Trust Company" reads as a trust rather than a company.
 */
const PATTERNS: Array<{ kind: EntityKind; re: RegExp }> = [
  // Trusts. `tr` and `rlt` are abbreviations that appear only in trust names here.
  // No `l` before \w*: the source data truncates long names, so "The 2023 Adelson
  // Carriage Irrevocab" and "Richard Butt & Jacqueline Butt Irrevocab" arrive cut off
  // mid-word. Requiring "revocabl" missed both.
  { kind: 'trust', re: /\b(?:ir)?revocab\w*\b/i },
  { kind: 'trust', re: /\btrusts?\b/i },
  { kind: 'trust', re: /\btrustees?\b|\bttees?\b/i },
  { kind: 'trust', re: /\brlt\b/i },
  { kind: 'trust', re: /\btr\b/i },
  { kind: 'trust', re: /\bliving\s+tr\w*\b/i },

  // Companies.
  { kind: 'company', re: /\bl\.?\s?l\.?\s?c\.?\b/i },
  { kind: 'company', re: /\bllp\b/i },
  { kind: 'company', re: /\binc\b/i },
  { kind: 'company', re: /\bcorp\w*\b/i },
  { kind: 'company', re: /\bcompany\b/i },
  { kind: 'company', re: /\blimited\b/i },
  { kind: 'company', re: /\bproperties\b/i },
  { kind: 'company', re: /\bholdings\b/i },
  { kind: 'company', re: /\bpartners?\b/i },
  { kind: 'company', re: /\brealty\b/i },
  { kind: 'company', re: /\bgroup\b/i },
  { kind: 'company', re: /\bassociation\b/i },

  // Municipalities and public bodies.
  { kind: 'government', re: /\btownship\b/i },
  { kind: 'government', re: /\bborough\b/i },
  { kind: 'government', re: /\b(?:city|county|town)\s+of\b/i },
  { kind: 'government', re: /\bmunicipal\w*\b/i },

  // Estates. Last, so "Real Estate Holdings Inc" is already a company by now.
  { kind: 'estate', re: /\bestate\b/i },
];

/** Join whatever name parts a caller has into one string to test. */
function joinName(parts: Array<string | null | undefined>): string {
  return parts
    .map((p) => String(p ?? '').replace(/\bnull\b/gi, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * The entity behind an owner name, or null if it looks like a person.
 *
 * Pass the name however you hold it — `ownerEntity(lead.owner1FirstName, lead.owner1LastName)`
 * or `ownerEntity(fullName)`.
 */
export function ownerEntity(...parts: Array<string | null | undefined>): OwnerEntity | null {
  const name = joinName(parts);
  if (!name) return null;

  for (const { kind, re } of PATTERNS) {
    const m = name.match(re);
    if (m) return { kind, matched: m[0], label: LABEL[kind] };
  }
  return null;
}

/** Convenience for the common lead shape. */
export function ownerEntityOf(lead: {
  owner1FirstName?: string | null;
  owner1LastName?: string | null;
} | null | undefined): OwnerEntity | null {
  if (!lead) return null;
  return ownerEntity(lead.owner1FirstName, lead.owner1LastName);
}

/** True when the owner of record is not a natural person. */
export function isEntityOwned(lead: {
  owner1FirstName?: string | null;
  owner1LastName?: string | null;
} | null | undefined): boolean {
  return ownerEntityOf(lead) !== null;
}

/**
 * An entity-owned lead as the blast reports it.
 *
 * Declared here rather than in the route because both the route and the dialog need the
 * shape, and a client component importing from an API route module is the kind of edge
 * that works until someone adds a server-only import to that route. This file has no
 * imports at all, so it is safe for either side to read.
 */
export type EntityLead = {
  propertyId: string;
  owner: string;
  address: string;
  effectiveDate: string | null;
  grade: string;
  /** "Trust" / "Company" / "Municipality" / "Estate". */
  label: string;
  /** The literal text that identified it, so a wrong call is visible on screen. */
  matched: string;
};

/**
 * The sentence shown wherever a trace is refused. Names the entity found, so a wrong
 * call is obvious to whoever is looking at it.
 */
export function entityTraceRefusal(e: OwnerEntity): string {
  return `${e.label} owned ("${e.matched}") — not eligible for skip trace, there is no named person to look up.`;
}
