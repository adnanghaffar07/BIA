/**
 * Does every sending mailbox carry a compliant signature? (Frank §4, §5)
 *
 *   node --import ./scripts/lib/register-ts.mjs scripts/check-signatures.mjs
 *
 * Reads only.
 *
 * The postal address and the opt-out line live ONLY in the signature, and §5 requires both on
 * every send. A mailbox with an empty one sends a non-compliant email and nothing says so.
 */
import './lib/env.mjs';
import { allSignatures } from '@/services/mailboxSignature.service';

const all = await allSignatures();
const ok = all.filter((s) => s.present && !s.problems.length);
const empty = all.filter((s) => !s.present);
const faulty = all.filter((s) => s.present && s.problems.length);

console.log(`${all.length} sending mailboxes`);
console.log(`  compliant      ${ok.length}`);
console.log(`  has problems   ${faulty.length}`);
console.log(`  EMPTY          ${empty.length}\n`);

for (const s of faulty) {
  console.log(`${s.email}  (${s.name})`);
  for (const p of s.problems) console.log(`    · ${p}`);
}
if (empty.length) {
  console.log(`\nempty — would send with no postal address and no opt-out line:`);
  const byDomain = new Map();
  for (const s of empty) {
    const d = s.email.split('@')[1];
    byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
  }
  for (const [d, n] of byDomain) console.log(`    ${d.padEnd(26)} ${n}`);
}
