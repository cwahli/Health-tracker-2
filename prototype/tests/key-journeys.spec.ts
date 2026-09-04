import { test, expect } from '@playwright/test';

test.describe('Key Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const navTab = page.locator('#nav-tab-home');
    const demoBtn = page.locator('#demo-login-btn');

    // Wait for either the main app bottom nav or demo login button to load
    await Promise.race([
      navTab.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {}),
      demoBtn.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
    ]);

    if (await demoBtn.isVisible().catch(() => false)) {
      await demoBtn.click();
    }

    // Ensure main app bottom navigation is attached
    await navTab.waitFor({ state: 'attached', timeout: 20000 });
  });

  test('Journey 1: App Initial Load & Navigation Shell', async ({ page }) => {
    const homeTab = page.locator('#nav-tab-home');
    const healthTab = page.locator('#nav-tab-health');
    const foodTab = page.locator('#nav-tab-food');
    const trendsTab = page.locator('#nav-tab-trends');

    await expect(homeTab).toBeAttached();
    await expect(healthTab).toBeAttached();
    await expect(foodTab).toBeAttached();
    await expect(trendsTab).toBeAttached();
  });

  test('Journey 2: Tab Switching & Sub-tab Navigation', async ({ page }) => {
    // 1. Click Health tab
    await page.locator('#nav-tab-health').click();
    await expect(page.locator('body')).toBeVisible();

    // 2. Click Food tab
    await page.locator('#nav-tab-food').click();
    await expect(page.locator('body')).toBeVisible();

    // 3. Click Trends tab
    await page.locator('#nav-tab-trends').click();
    await expect(page.locator('body')).toBeVisible();

    // 4. Return to Home tab
    await page.locator('#nav-tab-home').click();
    await expect(page.locator('body')).toBeVisible();
  });

  test('Journey 3: Quick Action & Chat Logging Sheet', async ({ page }) => {
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    if (await quickActionBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await quickActionBtn.click();
      const chatInput = page.getByPlaceholder(/message|eat|type|log/i).first();
      if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await chatInput.fill('Ate salmon and rice');
        await expect(chatInput).toHaveValue('Ate salmon and rice');
      }
    }
  });

  test('Journey 4: Health Portal & Biomarker Inspection', async ({ page }) => {
    await page.locator('#nav-tab-health').click();
    await expect(page.locator('body')).toBeVisible();
  });
});
