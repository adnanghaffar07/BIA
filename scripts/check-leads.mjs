import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(match[1]);

const rows = await sql`SELECT COUNT(*) AS total, COUNT("grade") AS with_grade, COUNT("coastDistanceMiles") AS with_coast FROM "Lead"`;
console.log('DB stats:', rows[0]);

const sample = await sql`SELECT "propertyId", "addressStreet", "grade", "coastDistanceMiles", "coastExposure", "latitude", "longitude" FROM "Lead" LIMIT 3`;
console.log('Sample leads:', JSON.stringify(sample, null, 2));
