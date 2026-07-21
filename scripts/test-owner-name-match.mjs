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
const { compareOwnerNames } = await import(pathToFileURL(join(out, 'ownerNameMatch.service.js')).href);

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

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error('  ' + f)); process.exit(1); }
