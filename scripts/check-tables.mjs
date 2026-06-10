import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf-8');
const match = env.match(/DATABASE_URL="([^"]+)"/);
const sql = neon(match[1]);

const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
console.log('Tables:', tables.map(t => t.table_name));

// Check Lead table structure
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Lead' ORDER BY ordinal_position LIMIT 30`;
console.log('Lead columns (first 30):', cols.map(c => `${c.column_name}:${c.data_type}`));
