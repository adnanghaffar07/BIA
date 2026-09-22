/**
 * Entity-owned leads are never skip traced (Frank Sep-2026).
 *
 * Usage:  node --import ./scripts/lib/register-ts.mjs scripts/test-owner-entity.mjs
 *
 * Reads only — spends no credits and writes nothing.
 *
 * The cases that matter here are the FALSE POSITIVES. An entity we fail to spot costs 15
 * credits and shows up as a miss, which is recoverable. A real homeowner wrongly flagged
 * stops being traced and stops being mailed, silently, with no error anywhere. Every
 * surname below is a real one from the live data that a looser pattern did flag.
 */
import './lib/env.mjs';
import { sql } from '@/lib/neon';
import { ownerEntity, ownerEntityOf, isEntityOwned, entityTraceRefusal } from '@/lib/ownerEntity';
import { skipTraceBlocker } from '@/services/skipTraceApply.service';
import { canRunSkipTrace } from '@/services/grade.service';
import { leadsAtStage, runTracerfyBlast } from '@/services/recoveryPipeline.service';

let pass = 0; const fail = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail.push(n); console.log(`  FAIL  ${n} ${d}`); } };

console.log('--- 1. entities are recognised, and named ---');
for (const [name, kind] of [
  ['Maybloom Family Trust', 'trust'],
  ['The Ar Grinberger Legacy Trust', 'trust'],
  ['Lucas Stewart Ralston Rlt', 'trust'],
  ['Joseph M Curran & Ethel M Curran Rev Tr', 'trust'],
  ['Marianne D Garofolo Irrevocable', 'trust'],
  // Truncated mid-word by the source data — the case the first pattern missed.
  ['The 2023 Adelson Carriage Irrevocab', 'trust'],
  ['Richard Butt & Jacqueline Butt Irrevocab', 'trust'],
  ['Triple C Housing Inc', 'company'],
  ['Ginsberg Realty, Llc', 'company'],
  ['Bayit Realty Corp', 'company'],
  ['Dnt Holdings Group Limited', 'company'],
  ['Township Of Howell', 'government'],
  ['Borough Of Tinton Falls', 'government'],
  ['County Of Middlesex', 'government'],
  ['Estate Of Eileen Perel', 'estate'],
]) {
  const e = ownerEntity(name);
  ok(`"${name}" -> ${kind}`, e?.kind === kind, `got ${e ? e.kind : 'null'}`);
}

console.log('--- 2. real people are NOT flagged (every one a live owner name) ---');
for (const name of [
  // "borough" sits inside "Yarborough"; "bank" inside five separate real surnames.
  'Brandon Yarborough', 'Georgette R Banks', 'Krunal Banker', 'Edward Burbank',
  'Jessica Burbank', 'Kiran Kumar Bankupalli', 'Larry Wiltbank',
  'Ashley Schooling', 'Aishah Manuel-Ebanks',
  'Alfredo Olmedo', 'William Zielenbach', 'Miles Bartholomew', 'Dovid Rapaport',
  'Busch, Michael A & Demarco,Shari A',
]) {
  ok(`"${name}" is a person`, ownerEntity(name) === null, `flagged as ${ownerEntity(name)?.kind}`);
}

console.log('--- 3. the ordering rule: the more specific kind wins ---');
ok('"Morgan Real Estate Trust" is a trust, not an estate', ownerEntity('Morgan Real Estate Trust')?.kind === 'trust');
ok('"Rbc Trust Company" is a trust, not a company', ownerEntity('Rbc Trust Company')?.kind === 'trust');
ok('"Spartan Real Estate Holdings Inc" is a company', ownerEntity('Spartan Real Estate Holdings Inc')?.kind === 'company');

console.log('--- 4. empty and junk input ---');
ok('no name is not an entity', ownerEntity('') === null);
ok('null parts are not an entity', ownerEntity(null, undefined) === null);
ok('the literal string "null" is stripped, not matched', ownerEntity('null', 'null') === null);

console.log('--- 5. the guards actually refuse ---');
const trustLead = {
  propertyId: 'T1', grade: 'A', owner1FirstName: 'Maybloom', owner1LastName: 'Family Trust',
};
const personLead = {
  propertyId: 'P1', grade: 'A', owner1FirstName: 'Alfredo', owner1LastName: 'Olmedo',
};
ok('skipTraceBlocker refuses a trust', skipTraceBlocker(trustLead, { grades: ['A'] }) !== null);
ok('...and says why, naming the match',
  /trust/i.test(String(skipTraceBlocker(trustLead, { grades: ['A'] }))),
  String(skipTraceBlocker(trustLead, { grades: ['A'] })));
ok('skipTraceBlocker still allows a person', skipTraceBlocker(personLead, { grades: ['A'] }) === null,
  String(skipTraceBlocker(personLead, { grades: ['A'] })));
ok('canRunSkipTrace refuses a trust', canRunSkipTrace(trustLead) === false);
ok('canRunSkipTrace still allows a person', canRunSkipTrace(personLead) === true);

console.log('--- 6. the refusal reads as a sentence ---');
const e = ownerEntity('Maybloom Family Trust');
ok('refusal names the entity and the reason',
  /Trust owned \("Trust"\).*no named person/.test(entityTraceRefusal(e)), entityTraceRefusal(e));

console.log('--- 7. against the live data ---');
const leads = await sql`
  SELECT "id","propertyId","owner1FirstName","owner1LastName","grade","manualGrade",
         "skipTraced","deepSkipTracedAt"
    FROM "Lead"`;
const flagged = leads.filter(isEntityOwned);
console.log(`    ${flagged.length} of ${leads.length} leads are entity-owned (${(flagged.length / leads.length * 100).toFixed(1)}%)`);
ok('the population is in the expected band (5-9%)',
  flagged.length / leads.length > 0.05 && flagged.length / leads.length < 0.09,
  `${(flagged.length / leads.length * 100).toFixed(1)}%`);
ok('no entity-owned lead is offered the trace button',
  flagged.every((l) => canRunSkipTrace(l) === false));

const tracedEntities = flagged.filter((l) => l.deepSkipTracedAt || l.skipTraced === true);
console.log(`    entity-owned leads traced BEFORE this guard existed: ${tracedEntities.length}`);
ok('and none can be traced again now',
  tracedEntities.every((l) => skipTraceBlocker(l, { grades: ['A', 'B', 'C'] }) !== null));

console.log('--- 8. the recovery pipeline (QC → Blast Skip Traces) ---');
const stages = ['isolated', 'tracerfy', 'batchdata', 'recovered'];
for (const stage of stages) {
  const rows = await leadsAtStage(stage);
  const ents = rows.filter((r) => r.entity);
  ok(`${stage}: every row carries an entity verdict`,
    rows.every((r) => r.entity === null || (r.entity.label && r.entity.matched)));
  ok(`${stage}: the verdict agrees with the shared detector`,
    rows.every((r) => (r.entity !== null) === isEntityOwned({
      owner1FirstName: r.owner.split(' ')[0], owner1LastName: r.owner.split(' ').slice(1).join(' '),
    })));
  if (ents.length) console.log(`    ${stage}: ${ents.length} of ${rows.length} are entity-owned`);
}

// A dry run reports the split without calling anyone, which is what the tab reads.
const dry = await runTracerfyBlast({ dryRun: true, limit: 100 });
console.log(`    dry run — pool ${dry.pool} workable, ${dry.entityOwned} entity-owned held back`);
ok('a dry run reports entities separately', typeof dry.entityOwned === 'number');
ok('and the pool EXCLUDES them, so the button cannot promise them',
  dry.pool === (await leadsAtStage('isolated')).filter((r) => !r.entity).length,
  `pool=${dry.pool}`);
ok('a dry run still calls nobody', dry.attempted === 0);

console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { fail.forEach((f) => console.log('  · ' + f)); process.exit(1); }
