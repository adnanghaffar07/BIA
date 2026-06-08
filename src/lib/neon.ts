import { neon } from '@neondatabase/serverless';

/**
 * Singleton Neon SQL client for Next.js API routes.
 * Uses Neon's native HTTP transport — no persistent TCP connection,
 * so there is no "connection closed" issue on Neon's idle timeout.
 */
const globalForSql = globalThis as unknown as {
  sql: ReturnType<typeof neon> | undefined;
};

export const sql = globalForSql.sql ?? neon(process.env.DATABASE_URL!);

if (process.env.NODE_ENV !== 'production') globalForSql.sql = sql;

export default sql;
