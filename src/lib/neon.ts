import { neon, Pool, neonConfig } from '@neondatabase/serverless';

/**
 * `sql` — tagged-template client for static/simple one-off queries.
 * Usage: const rows = await sql`SELECT 1`;
 *
 * `pool` — Pool client for parameterized queries via pool.query(sql, params).
 * Uses Neon's HTTP transport (no persistent TCP), safe on serverless.
 */

neonConfig.fetchConnectionCache = true;

// Tagged-template client (used for static queries in storage.service.ts)
const globalForNeon = globalThis as unknown as {
  sql: ReturnType<typeof neon> | undefined;
  pool: Pool | undefined;
};

export const sql = globalForNeon.sql ?? neon(process.env.DATABASE_URL!);
export const pool = globalForNeon.pool ?? new Pool({ connectionString: process.env.DATABASE_URL! });

if (process.env.NODE_ENV !== 'production') {
  globalForNeon.sql = sql;
  globalForNeon.pool = pool;
}

export default sql;
