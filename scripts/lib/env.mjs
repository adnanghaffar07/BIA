/**
 * Loads .env / .env.local into process.env.
 *
 * Imported for its side effect BEFORE any app service, because @/lib/neon builds its
 * client at module load: a static import of a service would run that first and fail with
 * "No database connection string was provided".
 */
import { readFileSync } from 'node:fs';

for (const file of ['.env', '.env.local']) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not found in .env / .env.local');
