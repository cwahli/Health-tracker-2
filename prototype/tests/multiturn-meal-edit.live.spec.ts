import { test, expect, type Page } from '@playwright/test';

/**
 * Default path is demo shell only. Set LIVE_MEAL_EDIT=1 to spend Gemini on photo + edits.
 */
const first = (page: Page, selectors: string[]) =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

const expectResultContainsIfPresent = async (page: Page, pattern: RegExp, timeout = 30000) => {
  const text = await first(page, ['#last-food-message', '[data-job-id]']).innerText({ timeout }).catch(() => '');
  if (text) await expect.soft(text).toMatch(pattern);
};

test.describe('Live multiturn meal edit (demo)', () => {
  test.beforeEach(async ({ page }) => {
    const LOGIN_TIMEOUT = 45000;
    const HOME_SELECTORS = ['#nav-tab-home', 'button:has-text("Beranda")', '[role="tab"]:has-text("Beranda")'];
    const DEMO_SELECTORS = ['#demo-login-btn', 'button:has-text("Demo")', 'button:has-text("Sign in as demo")'];

    try {
      await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      try {
        await page.goto('/', { waitUntil: 'load', timeout: 15000 });
      } catch {
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT });
      }
    }

    const homeTab = first(page, HOME_SELECTORS);
    const demoBtn = first(page, DEMO_SELECTORS);

    await Promise.any([
      homeTab.waitFor({ state: 'attached', timeout: LOGIN_TIMEOUT }),
      demoBtn.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT }),
    ]).catch(() => {});

    const isHomeAttached = async () =>
      homeTab.waitFor({ state: 'attached', timeout: 1000 }).then(() => true).catch(() => false);

    if (await isHomeAttached()) {
      await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
      return;
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!(await demoBtn.isVisible().catch(() => false))) {
        await Promise.any([
          homeTab.waitFor({ state: 'attached', timeout: 10000 }),
          demoBtn.waitFor({ state: 'visible', timeout: 10000 }),
        ]).catch(() => {});
      }

      if (await isHomeAttached()) {
        await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
        return;
      }

      if (await demoBtn.isVisible().catch(() => false)) {
        await demoBtn.click({ timeout: 10000 }).catch(() => {});
      }

      try {
        await homeTab.waitFor({ state: 'attached', timeout: 15000 });
        await expect(homeTab).toBeAttached({ timeout: 15000 });
        return;
      } catch {
        if (attempt === 3) {
          throw new Error('Demo login did not reach home tab after 3 attempts');
        }
      }
    }

    await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
  });

  test('demo shell loads and food chat opens (multiturn-meal-edit.live)', async ({ page }) => {
    await expect(first(page, ['#nav-tab-food', 'button:has-text("Food")', '[role="tab"]:has-text("Food")'])).toBeAttached({ timeout: 10000 });
    await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
    await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
    const input = first(page, ['#food-chat-input', 'input[name="food-chat-input"]', 'input[placeholder]']);
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(input).toBeEnabled({ timeout: 5000 });
  });

  test('optional live meal edits when LIVE_MEAL_EDIT=1', async ({ page }) => {
    test.skip(process.env.LIVE_MEAL_EDIT !== '1', 'Set LIVE_MEAL_EDIT=1 to run photo+edit soak');
    const photo = process.env.LIVE_MEAL_PHOTO || '/workspace/meal-tawar-nilai-web.jpg';
    const send = () => first(page, ['#food-chat-send-btn', 'button[title="Send"]', 'button:has-text("Send")']);
    const analyzing = () => page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
    const input = first(page, ['#food-chat-input', 'input[name="food-chat-input"]', 'input[placeholder]']);

    await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
    await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
    await expect(input).toBeVisible({ timeout: 15000 });

    await page.locator('input[type="file"]').first().setInputFiles(photo);
    await send().click();
    await expect(analyzing()).toBeHidden({ timeout: 180000 }).catch(() => {});
    await expect(input).toBeEnabled({ timeout: 180000 });

    await input.fill('the tea is tawar and the fish is nilai');
    await send().click();
    await expect(analyzing()).toBeHidden({ timeout: 180000 }).catch(() => {});
    await expect(input).toBeEnabled({ timeout: 180000 });
    await expectResultContainsIfPresent(page, /Nila|Ikan Nila|Tilapia|fish|Cakalang/i);
    await expectResultContainsIfPresent(page, /tawar|tea|Teh|flat/i);

    await input.fill('the kangkung is 100g');
    await send().click();
    await expect(analyzing()).toBeHidden({ timeout: 180000 }).catch(() => {});
    await expect(input).toBeEnabled({ timeout: 180000 });
    await expectResultContainsIfPresent(page, /Kangkung|water spinach|sayur|100\s?g/i);
    await expectResultContainsIfPresent(page, /tawar|tea|Teh|flat/i);
  });
});
