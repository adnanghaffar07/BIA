import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Load .env.local into process.env.
 *
 * Same parser as scripts/lib/env.mjs rather than a dotenv dependency — the project does
 * not have one, and an E2E harness is not a reason to add a package to the app.
 *
 * Credentials are read from E2E_EMAIL / E2E_PASSWORD and never appear in a spec, on a
 * command line or in a report. The login helper types them straight from the environment,
 * so the value is handled by the browser and by nothing else.
 */
for (const file of ['.env', '.env.local']) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One worker: these run against the live Neon database that production also uses.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // The dev server the project already has running.
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
