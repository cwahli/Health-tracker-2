import { test, expect } from '@playwright/test';

/**
 * R-3 thin smoke: prefer empty Front Desk chrome; fallback Indonesian UI crawl.
 * Demo/stub only — no live Gemini meal analyze.
 */
test.describe('R-3 smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const navTab = page.locator('#nav-tab-home');
    const demoBtn = page.locator('#demo-login-btn');

    await Promise.race([
      navTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}),
      demoBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    ]);

    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
    }

    await navTab.waitFor({ state: 'attached', timeout: 20000 });
  });

  test('empty Front Desk chrome or Indonesian leftover crawl', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    const frontDeskBtn = page
      .getByRole('button', { name: /front desk|receptionist|health info|health coach/i })
      .or(page.locator('button[title*="Front Desk" i], button[aria-label*="Health Info" i]'))
      .first();

    if (!(await frontDeskBtn.isVisible().catch(() => false))) {
      if (await quickActionBtn.isVisible().catch(() => false)) {
        await quickActionBtn.click();
      }
    }

    if (await frontDeskBtn.isVisible().catch(() => false)) {
      await frontDeskBtn.click();
      const chatRoot = page.locator('#food-chat-container');
      const chatInput = page.locator('#food-chat-input');

      await expect(chatRoot).toBeVisible({ timeout: 15000 });
      await expect(chatInput).toBeVisible({ timeout: 5000 });
      await expect(chatInput).toHaveValue('');
      await expect(chatRoot).not.toContainText(/analysis failed|server error|unexpected|crash/i);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
      const visibleText = (await page.locator('button:visible, a:visible, [role="button"]:visible').allInnerTexts()).join(' ');

      if (/Beranda|Makanan|Kesehatan|Riwayat/i.test(visibleText)) {
        expect.soft(visibleText, 'no raw English Home').not.toMatch(/\bHome\b/);
        expect.soft(visibleText, 'no raw English Food').not.toMatch(/\bFood\b/);
        expect.soft(visibleText, 'no raw English Medical').not.toMatch(/\bMedical\b/);
      }
    }

    expect(pageErrors).toEqual([]);
  });
});
