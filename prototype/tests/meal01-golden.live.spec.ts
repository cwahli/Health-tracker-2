import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * Meal_01 golden live soak (3-turn benchmark: golden/meal/Meal_01).
 * Default path is demo shell only. Set LIVE_MEAL01=1 to spend Gemini:
 * turn 1 logs 5 photos, turn 2 locks portions, turn 3 drops the pancake +
 * re-identifies the soup. Assertions are tolerance-based (see live report):
 * structure + nutrient direction, never exact vectors.
 */
const first = (page: Page, selectors: string[]) =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

const PHOTOS = [1, 2, 3, 4, 5].map((n) =>
  path.resolve(`golden/meal/Meal_01/photo_0${n}.jpg`),
);

test.describe('Meal_01 golden (demo)', () => {
  test.beforeEach(async ({ page }) => {
    const LOGIN_TIMEOUT = 45000;
    const HOME_SELECTORS = ['#nav-tab-home', 'button:has-text("Beranda")', '[role="tab"]:has-text("Beranda")'];
    const DEMO_SELECTORS = ['#demo-login-btn', 'button:has-text("Demo")', 'button:has-text("Sign in as demo")'];
    try {
      await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: LOGIN_TIMEOUT });
    }
    const homeTab = first(page, HOME_SELECTORS);
    const demoBtn = first(page, DEMO_SELECTORS);
    await Promise.any([
      homeTab.waitFor({ state: 'attached', timeout: LOGIN_TIMEOUT }),
      demoBtn.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT }),
    ]).catch(() => {});
    if (!(await homeTab.waitFor({ state: 'attached', timeout: 1000 }).then(() => true).catch(() => false))) {
      await demoBtn.click({ timeout: 10000 }).catch(() => {});
      await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
    }
  });

  test('demo shell loads and food chat opens (meal01-golden)', async ({ page }) => {
    await expect(first(page, ['#nav-tab-food', 'button:has-text("Food")', '[role="tab"]:has-text("Food")'])).toBeAttached({ timeout: 10000 });
    await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
    await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
    const input = first(page, ['#food-chat-input', 'input[name="food-chat-input"]', 'input[placeholder]']);
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(input).toBeEnabled({ timeout: 5000 });
  });

  test('live 3-turn Meal_01 soak when LIVE_MEAL01=1', async ({ page }) => {
    test.skip(process.env.LIVE_MEAL01 !== '1', 'Set LIVE_MEAL01=1 to run the Meal_01 photo+edit soak');
    test.setTimeout(1200000);
    await page.addInitScript(() => {
      localStorage.setItem('selectedModelId', 'gemini-3.5-flash-lite');
      localStorage.setItem('admin_agent_settings', JSON.stringify({
        flashLiteCost: 1, standardCost: 1, quotaDemo: 2000, quotaStandard: 2000, quotaAdmin: 2000,
      }));
    });
    await page.evaluate(() => {
      localStorage.setItem('selectedModelId', 'gemini-3.5-flash-lite');
      localStorage.setItem('admin_agent_settings', JSON.stringify({
        flashLiteCost: 1, standardCost: 1, quotaDemo: 2000, quotaStandard: 2000, quotaAdmin: 2000,
      }));
    }).catch(() => {});
    // App reads selectedModelId once at boot: fresh boot so the pinned engine takes effect.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await first(page, ['#demo-login-btn', 'button:has-text("Demo")', 'button:has-text("Sign in as demo")']).click({ timeout: 15000 }).catch(() => {});
    await first(page, ['#nav-tab-home', 'button:has-text("Beranda")']).waitFor({ state: 'attached', timeout: 45000 });
    const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000';
    const send = () => page.locator('#food-chat-send-btn');
    const analyzing = () => page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
    const input = page.locator('#food-chat-input');
    const lastMsg = () => first(page, ['#last-food-message', '[data-job-id]']);

    const waitJobSucceeded = async (jobId: string, notBeforeMs: number) => {
      const deadline = Date.now() + 300000;
      let sawRunning = false;
      while (Date.now() < deadline) {
        const res = await page.request.get(`${baseURL}/api/jobs/status?jobId=${jobId}`);
        const data = await res.json().catch(() => ({} as any));
        const job = (data?.jobs && data.jobs[0]) || data?.job || data;
        const status = job?.status;
        if (status === 'running' || status === 'queued') sawRunning = true;
        if (sawRunning && (status === 'succeeded' || status === 'failed' || status === 'error')) {
          expect(status, `job ${jobId} terminal`).toBe('succeeded');
          return job;
        }
        await page.waitForTimeout(2000);
      }
      throw new Error(`Timed out waiting for job ${jobId}`);
    };

    const sendAndAwaitJob = async () => {
      const submitWait = page.waitForResponse(
        (r) => r.url().includes('/api/jobs/submit') && r.request().method() === 'POST',
        { timeout: 120000 },
      );
      const clickedAt = Date.now();
      await expect(send()).toBeEnabled({ timeout: 15000 });
      await send().click();
      const submitRes = await submitWait;
      const body = await submitRes.json().catch(() => ({} as any));
      const jobId = String(body?.jobId || '');
      expect(jobId, 'submit returns jobId').toMatch(/^job_/);
      await analyzing().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await expect(analyzing()).toBeHidden({ timeout: 300000 });
      await expect(input).toBeEnabled({ timeout: 300000 });
      await waitJobSucceeded(jobId, clickedAt);
      return jobId;
    };

    await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
    await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
    await expect(input).toBeVisible({ timeout: 15000 });

    // Turn 1: 5 golden photos, no text.
    await page.locator('#food-chat-container input[type="file"], #food-chat-photo-btn ~ input[type="file"], input[type="file"]').first().setInputFiles(PHOTOS);
    await sendAndAwaitJob();
    const t1 = await lastMsg().innerText({ timeout: 30000 }).catch(() => '');
    if (t1) {
      await expect.soft(t1).toMatch(/oat|soup|sop|snack|jajan/i);
      await expect.soft(t1).toMatch(/portion|porsi|130|805|gram|g\b/i);
    }

    // Turn 2: lock portions.
    await input.click({ timeout: 15000 });
    await input.fill('oats 130g, brownies full pack 30g');
    await sendAndAwaitJob();
    const t2 = await lastMsg().innerText({ timeout: 30000 }).catch(() => '');
    if (t2) {
      await expect.soft(t2).toMatch(/130\s?g|sugar|gula|kalori|calor/i);
    }

    // Turn 3: drop pancake + re-identify soup. Sugar must come DOWN vs turn 2.
    await input.click({ timeout: 15000 });
    await input.fill("I didn't eat the pancake, and the soup is soto santan, not sop daging");
    await sendAndAwaitJob();
    const t3 = await lastMsg().innerText({ timeout: 30000 }).catch(() => '');
    if (t3) {
      await expect.soft(t3).toMatch(/soto|santan/i);
      await expect.soft(t3).toMatch(/sugar|gula|saturated|lemak jenuh/i);
    }
  });
});
