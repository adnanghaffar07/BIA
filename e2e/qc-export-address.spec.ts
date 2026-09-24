import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Does every per-lead export actually carry a street address?
 *
 * scripts/test-report-address.mjs asserts the SERVICE returns one. This asserts it reaches
 * the FILE, which is a separate question: the CSV is written from the column list, so a
 * field can be present on every row and still never be exported.
 *
 * Reads only. Downloads a file and reads it back; changes nothing.
 */

/** Same flow and same reasoning as the outreach spec's helper. */
async function login(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error('E2E_EMAIL / E2E_PASSWORD missing from .env.local');

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const emailBox = page.locator('input[type="email"], input[name="email"]').first();
  const pwBox = page.locator('input[type="password"], input[name="password"]').first();
  const submit = page.getByRole('button', { name: /sign in|log in/i });

  for (let attempt = 1; attempt <= 4; attempt++) {
    await emailBox.fill('');
    await pwBox.fill('');
    await emailBox.pressSequentially(email, { delay: 15 });
    await pwBox.pressSequentially(password, { delay: 15 });
    await submit.click();

    const left = page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => 'left' as const).catch(() => 'timeout' as const);
    const rejected = page.getByText(/enter both email and password/i)
      .waitFor({ timeout: 20_000 }).then(() => 'rejected' as const).catch(() => 'timeout' as const);

    if (await Promise.race([left, rejected]) === 'left') return;
    if (attempt === 4) throw new Error('login never left /login after 4 attempts');
    await page.waitForTimeout(500);
  }
}

/** Split one CSV line, honouring quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function exportAndRead(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const path = await download.path();
  // The writer prepends a UTF-8 BOM for Excel; strip it before parsing.
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  return { header: splitCsvLine(lines[0]), rows: lines.slice(1).map(splitCsvLine) };
}

test.describe('QC exports carry the property address', () => {
  /**
   * Both reports are named deliberately.
   *
   * Reachability builds its rows from a hand-written SELECT rather than SELECT *, to avoid
   * dragging the rawData blob over ~10,000 leads. A field added to the shared row mapper is
   * therefore null there unless its column was added to that SELECT too — and it exports as
   * an empty column with no error anywhere. Renewal Week takes the ordinary path, so the
   * pair covers both ways a row can be built.
   */
  test('the two go-live email lists export, and the wider one is a superset', async ({ page }) => {
    /**
     * Frank, 23 Sep 2026: "Two email export reports for C1–C3 (Oct 5–25): insured emails,
     * and insured or co-insured emails."
     *
     * The relationship between them is the deliverable, not either list on its own — the
     * difference is what the insured-only rule costs in reach. So this asserts the wider
     * list contains the narrower one rather than checking each in isolation, which would
     * pass on two lists built from different populations.
     */
    await login(page);
    await page.goto('/admin/qc', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    /**
     * Wait for the REPORT to be on screen, not for the export button to be enabled.
     *
     * Enabled-ness is left over from the previous run: switching reports does not clear the
     * rows, so the button is already live and the assertion passes instantly — the first
     * version of this exported the previous report and compared it against itself. Waiting
     * for a column header only this report renders ties the wait to the thing being tested.
     */
    /**
     * Set the range ONCE, and confirm it stuck before running anything.
     *
     * Filling a date box and clicking Run in the same breath is a race: fill() writes the
     * DOM and React may not have the value yet, so the first run went out unfiltered and
     * returned every week in the book. The two lists then described different populations
     * and the subset check failed on 650 leads — which is the test doing its job, but for
     * the wrong reason. The boxes are sticky, so one setting covers both runs.
     */
    await page.getByLabel('Eff from').fill('2026-10-05');
    await page.getByLabel('Eff to').fill('2026-10-25');
    await expect(page.getByLabel('Eff from')).toHaveValue('2026-10-05');
    await expect(page.getByLabel('Eff to')).toHaveValue('2026-10-25');

    const run = async (label: string, marker: string) => {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByRole('columnheader', { name: marker, exact: true }))
        .toBeVisible({ timeout: 60_000 });
      return exportAndRead(page);
    };

    const insured = await run('Email list — insured', 'Insured Email');
    expect(insured.header, 'insured list has the address column').toContain('Insured Email');
    expect(insured.header, 'insured list must NOT carry co-insured addresses')
      .not.toContain('Co-Insured Email');
    expect(insured.rows.length).toBeGreaterThan(0);

    const both = await run('Email list — insured or co-insured', 'Co-Insured Email');
    for (const col of ['Insured Email', 'Co-Insured Name', 'Co-Insured Email', 'Co-Insured Only']) {
      expect(both.header, `wider list carries ${col}`).toContain(col);
    }

    // Every lead in the narrow list appears in the wide one.
    const idCol = insured.header.indexOf('Lead ID');
    expect(idCol).toBeGreaterThan(-1);
    const wideIds = new Set(both.rows.map((r) => r[both.header.indexOf('Lead ID')]));
    const missing = insured.rows.map((r) => r[idCol]).filter((id) => !wideIds.has(id));
    expect(missing, 'leads in the insured list that are absent from the wider one').toEqual([]);
    expect(both.rows.length).toBeGreaterThanOrEqual(insured.rows.length);

    /** Every row must actually carry an address — this is a send list, not a coverage report. */
    const ei = insured.header.indexOf('Insured Email');
    expect(insured.rows.every((r) => (r[ei] ?? '').includes('@'))).toBe(true);
  });

  for (const report of ['Reachability', 'Renewal Week']) {
    test(`${report}: the CSV has an Address column with real values`, async ({ page }) => {
      await login(page);
      await page.goto('/admin/qc', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      await page.getByRole('button', { name: report, exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled({ timeout: 60_000 });

      const { header, rows } = await exportAndRead(page);
      expect(header, 'the header carries Address').toContain('Address');
      expect(rows.length, 'the file has rows').toBeGreaterThan(0);

      /**
       * Populated, not merely present. An empty column is exactly what a missing field in a
       * hand-written SELECT produces, and a header-only assertion would pass on it.
       */
      const i = header.indexOf('Address');
      const filled = rows.filter((r) => r[i] && r[i] !== '—').length;
      expect(filled, `${report}: Address values in the file`).toBeGreaterThan(0);

      // Address must be its own column, not a restatement of City / ZIP.
      const cityIdx = header.indexOf('City / ZIP');
      expect(cityIdx).toBeGreaterThan(-1);
      const sample = rows.find((r) => r[i] && r[i] !== '—')!;
      expect(sample[i]).not.toBe(sample[cityIdx]);
    });
  }
});
