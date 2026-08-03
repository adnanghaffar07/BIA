/**
 * Tests for the owner-name matcher (src/services/ownerNameMatch.service.ts).
 *
 *   npm run test:names
 *
 * Compiles the real TypeScript service to a temp dir and exercises THAT — not a
 * re-implementation — so the tests can't drift from the shipped logic. (This caught
 * a real bug: splitPerson tested the normalized string for a comma, but norm()
 * strips punctuation, so every "LAST, FIRST" tax-roll name was parsed backwards.)
 *
 * Cases are drawn from the real book: 219 entities with no first name, 148 LLCs,
 * 69 middle initials, 42 trusts, 18 two-party names, 15 suffixes, 6 hyphenated.
 */
import { execSync } from 'child_process';
import { rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const out = mkdtempSync(join(tmpdir(), 'bia-nametest-'));
execSync(
  `npx tsc src/services/ownerNameMatch.service.ts --outDir "${out}" --module es2020 --target es2020 --moduleResolution node`,
  { stdio: 'pipe' },
);
const { compareOwnerNames, parseRollOwners } = await import(pathToFileURL(join(out, 'ownerNameMatch.service.js')).href);

let pass = 0; const failures = [];
const t = (label, ours, theirs, expect) => {
  const r = compareOwnerNames(ours, theirs);
  if (r.result === expect) { pass++; console.log(`  ok   ${label}`); }
  else { failures.push(`${label} → got "${r.result}", expected "${expect}"`); console.log(`  FAIL ${label} → ${r.result} (expected ${expect})`); }
};

console.log('\nVerified against the live Howell tax portal:');
t('Theresa Brummer vs "BRUMMER, THERESA"', { first: 'Theresa', last: 'Brummer' }, 'BRUMMER, THERESA', 'match');
t('a different lead against that record', { first: 'Matthew', last: 'Desanto' }, 'BRUMMER, THERESA', 'mismatch');

console.log('\nReal name shapes from the book:');
t('middle initial (Irene C Casamento)', { first: 'Irene C', last: 'Casamento' }, 'CASAMENTO, IRENE', 'match');
t('suffix (Raymond Mcmanus Jr)', { first: 'Raymond', last: 'Mcmanus Jr' }, 'MCMANUS, RAYMOND', 'match');
t('hyphenated surname', { first: 'Samantha', last: 'Aguilar-Sanchez' }, 'AGUILAR SANCHEZ, SAMANTHA', 'match');
t('LLC with no first name', { first: '', last: 'Kasmon Llc' }, 'KASMON LLC', 'match');
t('record lists two parties', { first: 'Michael', last: 'Tarantul' }, 'TARANTUL, MICHAEL & TATYANA TARANTUL', 'match');
t('our initial vs their full first name', { first: 'C', last: 'Markowitz' }, 'MARKOWITZ, CINDY', 'match');
t('revocable trust', { first: '', last: 'Janet Lobel Revocable Trust' }, 'LOBEL JANET REVOCABLE TRUST', 'match');
t('municipality', { first: '', last: 'Borough Of Freehold' }, 'BOROUGH OF FREEHOLD', 'match');
t('plain "First Last" record format', { first: 'Lee', last: 'Lessner' }, 'LEE LESSNER', 'match');
// Regression: found while sampling real Howell leads — reported as a mismatch.
t('compound surname spaced differently (De Vito / DEVITO)', { first: 'Michael', last: 'De Vito' }, 'DEVITO, MICHAEL & TAYLOR', 'match');
t('compound surname, other direction (VanDusen / VAN DUSEN)', { first: 'Ann', last: 'VanDusen' }, 'VAN DUSEN, ANN', 'match');

console.log('\nGrey zone — must be "partial", never a false tick:');
t('spouse listed on the tax roll instead', { first: 'Theresa', last: 'Brummer' }, 'BRUMMER, JOHN', 'partial');
// Real case from Middletown: same first name, surname one character off.
t('surname one char off, same first name (Labolt/ABOLT)', { first: 'Michelle', last: 'Labolt' }, 'ABOLT, MICHELLE LEIGH', 'partial');

console.log('\nMust never falsely match:');
t('same first name, different surname', { first: 'Theresa', last: 'Smith' }, 'BRUMMER, THERESA', 'mismatch');
// The near-miss rule must never upgrade to a tick, and must not fire on a genuinely
// different surname that happens to be short, or on a different first name.
t('near-miss surname is never a full match', { first: 'Michelle', last: 'Labolt' }, 'ABOLT, MICHELLE LEIGH', 'partial');
t('surname 2+ chars off stays a mismatch', { first: 'John', last: 'Smith' }, 'SMYTHE, JOHN', 'mismatch');
t('near-miss surname but different first name', { first: 'Robert', last: 'Labolt' }, 'ABOLT, MICHELLE LEIGH', 'mismatch');
t('unrelated entity', { first: '', last: 'Kasmon Llc' }, 'SPARTAN REAL ESTATE HOLDINGS INC', 'mismatch');
t('no record name', { first: 'Theresa', last: 'Brummer' }, '', 'unknown');
t('no insured name', { first: '', last: '' }, 'BRUMMER, THERESA', 'unknown');

// ── parseRollOwners — capturing BOTH insureds (Frank Jul-2026, verified vs live rolls)
console.log('\nTwo-insured extraction from the tax roll (parseRollOwners):');
const p = (label, raw, expect) => {
  const r = parseRollOwners(raw);
  const got = { p1: r.person1?.display ?? null, p2: r.person2?.display ?? null, entity: r.isEntity };
  const ok = got.p1 === expect.p1 && got.p2 === expect.p2 && got.entity === !!expect.entity;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { failures.push(`${label} → got ${JSON.stringify(got)}, expected ${JSON.stringify(expect)}`); console.log(`  FAIL ${label} → ${JSON.stringify(got)}`); }
};
p('spouse, shared surname (Scheidt)', 'SCHEIDT, WOODROW W & MARY ANN', { p1: 'Woodrow Scheidt', p2: 'Mary Scheidt' });
p('spouse, shared surname (Perez)', 'PEREZ, ELIOT & MARISOL', { p1: 'Eliot Perez', p2: 'Marisol Perez' });
p('spouse with middle initials (Mescal)', 'MESCAL,DAMION V. & JANICE V.', { p1: 'Damion Mescal', p2: 'Janice Mescal' });
p('stray comma before ampersand (Montanaro)', 'MONTANARO, MICHAEL,& GINA', { p1: 'Michael Montanaro', p2: 'Gina Montanaro' });
p('second party repeats the surname (Tarantul)', 'TARANTUL, MICHAEL & TATYANA TARANTUL', { p1: 'Michael Tarantul', p2: 'Tatyana Tarantul' });
p('second party with own LAST, FIRST', 'SMITH, JOHN & DOE, JANE', { p1: 'John Smith', p2: 'Jane Doe' });
p('single owner → no second person', 'DEVINCENS, CHRISTINE', { p1: 'Christine Devincens', p2: null });
p('plain First Last, single owner', 'LEE LESSNER', { p1: 'Lee Lessner', p2: null });
p('LLC is an entity, not people', '525 REALTY HOLDING, INC', { p1: null, p2: null, entity: true });
p('trust is an entity, not people', '123 SOUTH MAIN STREET TRUST', { p1: null, p2: null, entity: true });
p('municipality is an entity', 'TOWNSHIP OF HOWELL', { p1: null, p2: null, entity: true });
p('empty string', '', { p1: null, p2: null });

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error('  ' + f)); process.exit(1); }
