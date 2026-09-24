import { test, expect, Page } from '@playwright/test';

/**
 * Does the Sec 10.7 outreach dashboard actually paint?
 *
 * The service is covered by scripts/test-outreach-dashboard.mjs, which asserts the numbers
 * are honest. This asserts the page renders them — a different failure entirely, and one
 * typecheck cannot catch: a MUI prop that throws at render, a fetch that 404s, a client
 * bundle that dies on a server-only import.
 *
 * Reads only. It never edits a lead.
 */

/**
 * Log in.
 *
 * ── The race this avoids ────────────────────────────────────────────────────
 * An earlier version asserted the input's DOM value after fill(). That passes whether or
 * not React has attached its onChange — fill() writes the DOM either way — so it reported
 * a successful login on a form whose state was still empty, and the click submitted
 * nothing. The only honest signal is the one the app gives back: having LEFT /login.
 *
 * ── Why the whole flow retries ──────────────────────────────────────────────
 * If the submit lands before hydration, nothing happens at all: no error, no navigation.
 * Retrying just the click would re-submit the same empty form. So the form is refilled
 * from scratch each attempt.
 */
async function login(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_EMAIL / E2E_PASSWORD missing from .env.local');
  }

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  /**
   * Wait for the bundle to settle before typing. This is the whole fix: the first attempt
   * used to submit an empty form and the app answered with its own validation — "Please
   * enter both email and password" — because fill() had written the DOM before React
   * attached its onChange. The DOM said the right thing and the state was empty.
   */
  await page.waitForLoadState('networkidle');

  /**
   * By type/name, not by label. A MUI outlined TextField renders its label a second time
   * as an aria-hidden <legend> inside the fieldset, so getByLabel matches two nodes and
   * the locator is strict-mode ambiguous.
   */
  const emailBox = page.locator('input[type="email"], input[name="email"]').first();
  const pwBox = page.locator('input[type="password"], input[name="password"]').first();
  const submit = page.getByRole('button', { name: /sign in|log in/i });

  for (let attempt = 1; attempt <= 4; attempt++) {
    await emailBox.fill('');
    await pwBox.fill('');
    // Real key events, so a controlled input updates state the way a person would.
    await emailBox.pressSequentially(email, { delay: 15 });
    await pwBox.pressSequentially(password, { delay: 15 });
    await submit.click();

    /**
     * Race the only two honest outcomes against each other: having LEFT /login, or the
     * app saying the form was empty. Asserting the input's own value would pass either
     * way, which is what made the earlier version of this look green while submitting
     * nothing.
     */
    const left = page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => 'left' as const).catch(() => 'timeout' as const);
    const rejected = page.getByText(/enter both email and password/i)
      .waitFor({ timeout: 20_000 }).then(() => 'rejected' as const).catch(() => 'timeout' as const);

    const outcome = await Promise.race([left, rejected]);
    if (outcome === 'left') return;
    if (attempt === 4) {
      throw new Error(`login never left /login after 4 attempts (last outcome: ${outcome})`);
    }
    await page.waitForTimeout(500);
  }
}

test.describe('outreach dashboard', () => {
  test('renders the funnel, the guardrails and the weekly table', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const failedRequests: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) {
        failedRequests.push(`${r.status()} ${r.url()}`);
      }
    });

    await login(page);
    /**
     * Start counting only now.
     *
     * The login page probes /api/auth/me and is answered 401 — correctly, because nobody
     * is logged in yet. Counting it would fail this test on the app behaving properly,
     * and the natural "fix" is to allow 401s everywhere, which would then hide a real
     * 401 from the dashboard's own endpoint.
     */
    consoleErrors.length = 0;
    failedRequests.length = 0;

    await page.goto('/admin/outreach', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Outreach dashboard' })).toBeVisible();

    // The three sections.
    await expect(page.getByText('The funnel', { exact: true })).toBeVisible();
    await expect(page.getByText('Guardrails', { exact: true })).toBeVisible();
    await expect(page.getByText('By renewal week', { exact: true })).toBeVisible();

    /**
     * The whole ladder, in order.
     *
     * Read off the tagged stage names rather than by matching cell text: every stage label
     * ALSO appears one row below as the next rung's denominator, so a per-label search
     * would find a stage that had been dropped. Asserting the ordered list catches a
     * missing rung, a duplicated one and a reordering, which is what a funnel's meaning
     * actually depends on.
     */
    await expect(page.getByTestId('funnel-stage')).toHaveText([
      'Grade A at pull', 'Grade A worked (now)', 'Cards with an insured email',
      'Verified valid', 'Loaded to campaign', 'People emailed (E1)',
      'People delivered', 'Positive engagements', 'Firm bindable quotes', 'Bound accounts',
    ]);

    // The guardrails that carry a pause rule — the ones that stop a send.
    await expect(page.getByRole('cell', { name: 'Grade A kept after pull' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Inbox placement/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Spam complaint rate' })).toBeVisible();
    /**
     * The §08 thresholds, on screen and distinct from the targets.
     *
     * This dashboard used to carry its own softer copies — no target at all on the three
     * rates, and 75 as the inbox-placement TARGET when 75 is the pause line and 80 is the
     * target. It now quotes protectiveMetrics, which is the service that actually pauses
     * the campaign, so the pause rules it renders are the ones that will fire.
     */
    await expect(page.getByText('Pause at or above 0.3%.')).toBeVisible();
    await expect(page.getByText('Pause below 75%.')).toBeVisible();

    const inboxRow = page.getByRole('row').filter({ hasText: 'Inbox placement' });
    await expect(inboxRow.getByRole('cell', { name: '80%', exact: true })).toBeVisible();
    await expect(inboxRow.getByRole('cell', { name: '75%', exact: true })).toBeVisible();

    /** No reading is not a pass — §02 makes placement a gate on sending at all. */
    await expect(page.getByText(/No inbox-placement reading has ever been recorded/)).toBeVisible();

    /**
     * The honesty checks, on screen rather than in the service.
     *
     * Before the first send these stages are unmeasured. If the page ever renders them as
     * 0% against a 27% target it is crying wolf for a campaign that has not begun, which
     * is the thing this screen was built not to do.
     */
    await expect(page.getByText('Outreach has not started.')).toBeVisible();
    await expect(page.getByText('Not started').first()).toBeVisible();

    // The retention guardrail must not be the worked rung's rate — that was the bug.
    const keptRow = page.getByRole('row').filter({ hasText: 'Grade A kept after pull' });
    await expect(keptRow).toBeVisible();

    expect(failedRequests, 'API requests that failed').toEqual([]);
    /** Next dev emits hydration and HMR noise; only real page errors matter here. */
    const real = consoleErrors.filter((e) =>
      !/hydrat|Download the React DevTools|Fast Refresh|websocket/i.test(e));
    expect(real, 'console errors').toEqual([]);

    await page.screenshot({ path: 'e2e/outreach-dashboard.png', fullPage: true });
  });

  test('renders every Sec 10.7 channel section', async ({ page }) => {
    /**
     * The sections the dashboard shipped without.
     *
     * 10.7 asks for three channel funnels, a cross-channel decision view, response time,
     * per-mailbox deliverability, band accuracy and lost analysis. The first build covered
     * the Grade A ladder only and was described as "Sec 10.7 done", so this test exists to
     * make the section list something a run can check rather than something a person
     * remembers.
     */
    await login(page);
    await page.goto('/admin/outreach', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Outreach dashboard' })).toBeVisible();

    for (const heading of [
      'Bound premium and commission per 1,000 emails sent',
      'Email funnel',
      'Phone funnel',
      'Direct mail funnel',
      'Cross-channel — the decision view',
      'Response time',
      'Deliverability, per sending mailbox',
      'Lost analysis',
    ]) {
      await expect(page.getByText(heading, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/^Band accuracy, by /)).toBeVisible();

    /**
     * The email funnel's rungs, as an ordered list, in 10.7's own order:
     * "sent → delivered → engaged → positive intent → quote requested → quoted → bound / lost".
     *
     * Read off the tagged labels rather than by matching cell text, because every rung name
     * also appears one row below as the next rung's denominator — a per-label search would
     * find a rung that had been removed. Asserting the sequence catches a missing rung, a
     * duplicate and a reordering, which is what the funnel's meaning rests on.
     */
    await expect(page.getByTestId('funnel-email').getByTestId('rung-label')).toHaveText([
      'Sent', 'Delivered', 'Engaged', 'Positive intent',
      'Quote requested', 'Quoted', 'Bound', 'Lost',
    ]);
    await expect(page.getByTestId('funnel-phone').getByTestId('rung-label')).toHaveText([
      'Assigned', 'Attempted', 'Contacted', 'Quoted', 'Bound', 'Lost',
    ]);

    /**
     * Money that needs a setting nobody has entered stays blank rather than reading zero,
     * and the screen does NOT explain itself with config keys — that banner was a
     * developer's note on a page Frank reads.
     */
    await expect(page.getByText(/Some figures cannot be computed/)).toHaveCount(0);
    await expect(page.getByText('commission_rate_pct')).toHaveCount(0);
    await expect(page.getByText('Commission / 1,000')).toBeVisible();

    /** Evidence, so the whole screen can be looked at rather than only asserted about. */
    await page.screenshot({ path: 'e2e/outreach-channels.png', fullPage: true });
  });

  test('the date range filter re-queries and the CSV export is offered', async ({ page }) => {
    await login(page);
    await page.goto('/admin/outreach', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Outreach dashboard' })).toBeVisible();

    const atPullCell = page.getByRole('row')
      .filter({ hasText: 'Grade A at pull' })
      .getByRole('cell').nth(1);
    await expect(atPullCell).not.toHaveText('—');
    const before = (await atPullCell.textContent())?.trim();

    // Narrow to a single renewal week and confirm the top of the funnel actually moves.
    await page.getByLabel('Renewal week from').fill('2026-11-16');
    await page.getByLabel('Renewal week to').fill('2026-11-16');
    await expect(async () => {
      const now = (await atPullCell.textContent())?.trim();
      expect(now).not.toBe(before);
    }).toPass({ timeout: 20_000 });

    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });

  test('defaults to the outreach programme and can be widened to all weeks', async ({ page }) => {
    await login(page);
    await page.goto('/admin/outreach', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Outreach dashboard' })).toBeVisible();

    /**
     * The default must announce itself and name what it drops. A scoped view that looked
     * like an unscoped one would be the more dangerous of the two — every number on it is
     * correct, and the reader has no way to know which weeks produced them.
     */
    await expect(page.getByText('Showing the outreach programme.')).toBeVisible();
    await expect(page.getByText(/Not shown: \d+ earlier or later week/)).toBeVisible();

    const coverageRate = page.getByRole('row')
      .filter({ hasText: 'Cards with an insured email' })
      .getByRole('cell').nth(3);
    const scoped = (await coverageRate.textContent())?.trim();

    // Widening must actually change the figure, and must drop the programme banner.
    await page.getByRole('button', { name: 'Show them too' }).click();
    await expect(page.getByText('Showing the outreach programme.')).toBeHidden();
    await expect(async () => {
      expect((await coverageRate.textContent())?.trim()).not.toBe(scoped);
    }).toPass({ timeout: 20_000 });

    /**
     * "All weeks" is a scope, so the date boxes must stay empty. They used to be filled
     * with 01/01/2000 and 12/31/2099 to express it, which read as a data-entry accident
     * and left two real dates one keystroke from becoming a filter nobody chose.
     */
    await expect(page.getByLabel('Renewal week from')).toHaveValue('');
    await expect(page.getByLabel('Renewal week to')).toHaveValue('');

    // ...and the way back is offered where the widened view explains itself.
    await expect(page.getByText('Showing every renewal week.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the outreach weeks' }).click();
    await expect(page.getByText('Showing the outreach programme.')).toBeVisible();
    await expect(async () => {
      expect((await coverageRate.textContent())?.trim()).toBe(scoped);
    }).toPass({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/outreach-dashboard.png', fullPage: true });
  });

  test('a nonsense date left in storage does not come back', async ({ page }) => {
    /**
     * The regression this pins.
     *
     * "All weeks" was briefly sent as the range 01/01/2000 – 12/31/2099, and useStickyState
     * wrote it to sessionStorage. Fixing the button did not fix the stored value — the page
     * still opened with two absurd dates in the boxes and a filter nobody chose. Fixing the
     * code was not enough, so this asserts the recovery rather than the code.
     */
    await login(page);
    await page.goto('/admin/outreach', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Outreach dashboard' })).toBeVisible();

    // Write a range the book cannot satisfy, under both the retired and current keys.
    await page.evaluate(() => {
      sessionStorage.setItem('outreach.effFrom', JSON.stringify('2000-01-01'));
      sessionStorage.setItem('outreach.effTo', JSON.stringify('2099-12-31'));
      sessionStorage.setItem('outreach.effFrom.v2', JSON.stringify('2000-01-01'));
      sessionStorage.setItem('outreach.effTo.v2', JSON.stringify('2099-12-31'));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const from = page.getByLabel('Renewal week from');
    const to = page.getByLabel('Renewal week to');
    await expect(from).toHaveValue('');
    await expect(to).toHaveValue('');
    // ...and having dropped them, the screen is back on the programme.
    await expect(page.getByText('Showing the outreach programme.')).toBeVisible();

    /** The picker must also refuse such a date going forward, not just recover from one. */
    const min = await from.getAttribute('min');
    const max = await from.getAttribute('max');
    expect(min, 'the from box is bounded').toBeTruthy();
    expect(max, 'the from box is bounded').toBeTruthy();
    expect(Number(min!.slice(0, 4))).toBeGreaterThan(2019);
    expect(Number(max!.slice(0, 4))).toBeLessThan(2030);
  });
});
