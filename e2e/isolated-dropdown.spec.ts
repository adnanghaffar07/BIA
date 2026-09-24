import { test, expect, Page } from '@playwright/test';

/**
 * Isolated is its own field, not a status (Frank, 23 Sep 2026).
 *
 * "A separate 'isolated' dropdown will be added, so pulling a lead for skip trace never
 * overwrites its 'rated' status."
 *
 * Reads only. It opens a lead and asserts what the card shows; it never saves, because the
 * leads that prove the point are real isolated leads in the live book.
 */

/** Same flow and reasoning as the other specs' helper. */
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

/**
 * A lead isolated under the OLD rule: 'isolated' sits in its status column and the real
 * value is in isolatedFromStatus. It is the hardest case, because the card has to show a
 * status the database does not literally hold.
 */
const LEGACY_ISOLATED_LEAD = '251526455';

test.describe('isolated is its own field', () => {
  test('an isolated lead shows its real status, not "isolated"', async ({ page }) => {
    await login(page);
    await page.goto(`/leads/${LEGACY_ISOLATED_LEAD}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    const statusBox = page.getByLabel('Lead Status');
    const isolatedBox = page.getByLabel('Isolated');

    await expect(isolatedBox).toBeVisible();
    await expect(isolatedBox).toHaveText('Yes — no insured email');

    /**
     * The status must be a real one. 'isolated' has never been in LEAD_STATUS_OPTIONS, so
     * before this change the control was bound to a value it could not display — the whole
     * reason a rated lead stopped reading as rated.
     */
    await expect(statusBox).toBeVisible();
    const shown = (await statusBox.textContent())?.trim() ?? '';
    expect(shown.toLowerCase()).not.toContain('isolated');
    expect(shown.length, 'the status control shows something').toBeGreaterThan(0);

    /** The two are separate controls, so both are on the card at once. */
    await expect(statusBox).not.toHaveText('');
  });

  test('"Isolated" is gone from the Lead Status dropdown', async ({ page }) => {
    /**
     * It is not a status any more, so nobody should be able to choose it — that is the
     * whole change. But the entry has to survive as a LABEL: 46 leads still hold it, and
     * removing it outright would send leadStatusLabel() to its 'New' default and make every
     * one of them display as New.
     */
    await login(page);
    await page.goto(`/leads/${LEGACY_ISOLATED_LEAD}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    await page.getByRole('combobox', { name: 'Lead Status' }).click();
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();

    const labels = await options.allTextContents();
    expect(labels, 'the real statuses are still offered').toContain('Rated');
    expect(labels.some((l) => /isolated/i.test(l)), `Lead Status still offers: ${labels.join(', ')}`)
      .toBe(false);

    await page.keyboard.press('Escape');
  });

  test('the isolated dropdown offers both states and explains itself', async ({ page }) => {
    await login(page);
    await page.goto(`/leads/${LEGACY_ISOLATED_LEAD}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // The combobox, not the label: getByLabel resolves the <label>, which is not clickable.
    await page.getByRole('combobox', { name: 'Isolated' }).click();
    await expect(page.getByRole('option', { name: 'No — reachable' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Yes — no insured email' })).toBeVisible();
    // Close without choosing — this spec writes nothing.
    await page.keyboard.press('Escape');

    /**
     * The consequence is stated on the control, so setting it is never a surprise.
     *
     * Asserted on the caption element rather than by matching its words: when the lead
     * carries a stored isolation reason the caption shows that instead of the default, and
     * a text match would either miss it or accidentally match the select, which is labelled
     * with the same phrase.
     */
    const help = page.getByTestId('isolated-help');
    await expect(help).toBeVisible();
    expect(((await help.textContent()) ?? '').trim().length).toBeGreaterThan(20);
  });
});
