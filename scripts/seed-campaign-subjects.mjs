/**
 * Seed CampaignSubject from subjectFor(), the function that has been producing these lines
 * all along.
 *
 * Generated rather than typed. There are 25 of them, several differing by a word, and a
 * hand-written seed would have been a transcription exercise with a silent failure mode:
 * one mistyped line goes out to a cohort and nothing anywhere disagrees with it. Reading
 * them out of the live function means the seed cannot differ from what the system sends
 * today, which is the only guarantee worth having at the moment of a cutover.
 *
 * Idempotent: ON CONFLICT DO NOTHING, so a second run cannot overwrite an edit somebody has
 * since made on the screen.
 */
import './lib/env.mjs';
import { sql } from '../src/lib/neon.ts';
import { subjectFor, stepsFor } from '../src/services/campaignSegment.service.ts';

const WEEKS = {
  '2026-10-05': 'C1', '2026-10-12': 'C2', '2026-10-19': 'C3', '2026-10-26': 'C4',
  '2026-11-02': 'C5', '2026-11-09': 'C6', '2026-11-16': 'C7',
};

const rows = [];

// rated / unrated vary by cohort; grade_b does not.
for (const segment of ['rated', 'unrated']) {
  for (const step of [1, 2, 3]) {
    for (const variant of ['A', 'B']) {
      /** template -> the cohorts that share it */
      const byTemplate = new Map();
      for (const [week, code] of Object.entries(WEEKS)) {
        if (!stepsFor(week).includes(step)) continue;
        const s = subjectFor({ segment, cohort: week, step, variant });
        const key = `${s.name}\u0000${s.template}`;
        if (!byTemplate.has(key)) byTemplate.set(key, []);
        byTemplate.get(key).push(code);
      }
      for (const [key, cohorts] of byTemplate) {
        const [name, template] = key.split('\u0000');
        rows.push({ segment, step, variant, cohorts, name, template });
      }
    }
  }
}

// One pair for Grade B, every cohort and every step — stored with an empty cohort list,
// which is how the lookup reads "applies to all".
for (const variant of ['A', 'B']) {
  const s = subjectFor({ segment: 'grade_b', cohort: '2026-10-05', step: 1, variant });
  rows.push({ segment: 'grade_b', step: 1, variant, cohorts: [], name: s.name, template: s.template });
}

let inserted = 0;
for (const r of rows) {
  const res = await sql`
    INSERT INTO "CampaignSubject" ("id","segment","step","variant","cohorts","name","template","updatedBy")
    VALUES (${crypto.randomUUID()}, ${r.segment}, ${r.step}, ${r.variant},
            ${r.cohorts}::text[], ${r.name}, ${r.template}, 'seed')
    ON CONFLICT ("segment","step","variant","cohorts") DO NOTHING
    RETURNING "id"`;
  if (res.length) inserted++;
}

console.log(`${rows.length} subject lines derived from subjectFor(); ${inserted} inserted, ${rows.length - inserted} already present.`);
for (const r of rows) {
  console.log(`  ${r.segment.padEnd(8)} email ${r.step} ${r.variant}  ${(r.cohorts.join(',') || 'all').padEnd(16)} ${r.template}`);
}
