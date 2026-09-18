import './env.mjs';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const [l] = await sql`
  SELECT "id","owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
         "owner2Dob","owner2Phone","owner2Email","owner1Dob",
         "skipTraceData"->>'provider' AS provider,
         jsonb_array_length(COALESCE("skipTraceData"->'persons','[]'::jsonb)) AS cur,
         jsonb_array_length(COALESCE("skipTraceData"->'priorPersons','[]'::jsonb)) AS prior
    FROM "Lead" WHERE "owner1LastName" ILIKE 'Rothman' AND "addressStreet" ILIKE '%Evans%'`;
console.log('lead:', JSON.stringify(l));

const a = await sql`
  SELECT "type","content","createdBy",
         jsonb_pretty(COALESCE("metadata"->'insuredPatch','null'::jsonb)) AS patch,
         COALESCE(jsonb_array_length("metadata"->'emails'),0) AS e,
         COALESCE(jsonb_array_length("metadata"->'phones'),0) AS p
    FROM "Activity" WHERE "leadId"=${l.id} AND "type" IN ('skip_trace','contact_recovery')
   ORDER BY "createdAt"`;
for (const x of a) {
  console.log(`\n${x.type}: ${String(x.content).slice(0,70)}`);
  console.log(`  emails=${x.e} phones=${x.p} insuredPatch=${String(x.patch).replace(/\s+/g,' ').slice(0,220)}`);
}
