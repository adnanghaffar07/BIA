// One-off migration runner for the Neon "Lead" table.
// Usage: node --env-file=.env scripts/run-migration.mjs migrations/<file>.sql
//
// Routes queries over Neon's HTTP transport (poolQueryViaFetch) so it works
// without the optional `ws` package. Each migration file should be a single
// statement (e.g. one ALTER TABLE with multiple ADD COLUMN IF NOT EXISTS clauses).

import { readFileSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';

neonConfig.poolQueryViaFetch = true;

const file = process.argv[2];
if (!file) {
  console.error('usage: node --env-file=.env scripts/run-migration.mjs <file.sql>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (pass --env-file=.env)');
  process.exit(1);
}

const ddl = readFileSync(file, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(ddl);
  console.log(`✅ Applied ${file}`);

  // Verify: list the new columns now present on "Lead".
  const { rows } = await pool.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'Lead'
        AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    [[
      'owner2FirstName', 'owner2LastName', 'maritalStatus', 'owner1Dob', 'owner2Dob',
      'dogBreed', 'insuranceHistory', 'heatingRenovatedYear', 'bathroomsFull', 'bathroomsHalf',
      'garageType', 'garageCount', 'sidingType', 'foundationType', 'heatSource', 'feetFromHydrant',
      'burglarAlarm', 'fireAlarm', 'sprinklerSystem', 'smokeDetector', 'waterSensor',
      'autoWaterShutoff', 'lowTempSensor', 'leedCertified', 'effectiveDate',
    ]],
  );
  console.log(`Verified ${rows.length} columns present:`);
  for (const r of rows) console.log(`  • ${r.column_name} (${r.data_type})`);
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
