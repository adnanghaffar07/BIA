import './env.mjs';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const statements = readFileSync(process.argv[2], 'utf8')
  .split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
const c = await pool.connect();
try { for (const s of statements) { await c.query(s); console.log('ok:', s.split('\n')[0].slice(0, 60)); } }
finally { c.release(); await pool.end(); }
