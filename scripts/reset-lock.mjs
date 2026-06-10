import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const sql = neon(readFileSync('.env', 'utf-8').match(/DATABASE_URL="([^"]+)"/)[1]);
await sql`DELETE FROM "AppConfig" WHERE "key" = 'api_seeded'`;
console.log('✅ REAPI lock removed');
