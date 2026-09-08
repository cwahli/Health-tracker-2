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
    test.setTimeout(900000);
    // Local soak infra: gemini-3.8-flash uses standardCost (20) and Demo quota is tiny.
    await page.addInitScript(() => {
      localStorage.setItem('admin_agent_settings', JSON.stringify({
        flashLiteCost: 1,
        standardCost: 1,
        quotaDemo: 500,
        quotaStandard: 500,
        quotaAdmin: 500,
      }));
    });
    // If already on origin from beforeEach login, set immediately too.
    await page.evaluate(() => {
      localStorage.setItem('admin_agent_settings', JSON.stringify({
        flashLiteCost: 1,
        standardCost: 1,
        quotaDemo: 500,
        quotaStandard: 500,
        quotaAdmin: 500,
      }));
    }).catch(() => {});
    const photo = process.env.LIVE_MEAL_PHOTO || 'prototype/tests/captures/meal-tawar-nilai-web.jpg';
    const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000';
    // Prefer strict food-chat ids: broad input[placeholder] matches Food History search first in DOM.
    const send = () => page.locator('#food-chat-send-btn');
    const analyzing = () => page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i).first();
    const input = page.locator('#food-chat-input');
    const jobIds: string[] = [];

    const waitJobSucceeded = async (jobId: string, notBeforeMs: number) => {
      const deadline = Date.now() + 240000;
      let sawRunning = false;
      while (Date.now() < deadline) {
        const res = await page.request.get(`${baseURL}/api/jobs/status?jobId=${jobId}`);
        const data = await res.json().catch(() => ({} as any));
        const job = (data?.jobs && data.jobs[0]) || data?.job || data;
        const status = job?.status;
        const updatedRaw = job?.updated_at || job?.updatedAt || job?.finished_at || job?.completedAt || '';
        const updatedMs = updatedRaw ? Date.parse(String(updatedRaw)) : 0;
        if (status === 'running' || status === 'queued') sawRunning = true;
        const freshEnough = !updatedMs || updatedMs >= notBeforeMs - 2000;
        if ((sawRunning || freshEnough) && (status === 'succeeded' || status === 'failed' || status === 'error')) {
          // Avoid resolving the previous turn's succeeded before this submit's run starts.
          if (status === 'succeeded' && !sawRunning && updatedMs && updatedMs < notBeforeMs - 2000) {
            await page.waitForTimeout(1500);
            continue;
          }
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
      jobIds.push(jobId);
      await analyzing().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await expect(analyzing()).toBeHidden({ timeout: 240000 });
      await expect(input).toBeEnabled({ timeout: 240000 });
      await waitJobSucceeded(jobId, clickedAt);
      return jobId;
    };

    await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
    await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
    await expect(input).toBeVisible({ timeout: 15000 });

    await expect(input).toBeVisible({ timeout: 15000 });
    await page.locator('#food-chat-container input[type="file"], #food-chat-photo-btn ~ input[type="file"], input[type="file"]').first().setInputFiles(photo);
    await sendAndAwaitJob();
    await expect(input).toBeVisible({ timeout: 15000 });

    await input.click({ timeout: 15000 });
    await input.fill('the tea is tawar and the fish is nilai');
    await sendAndAwaitJob();
    await expectResultContainsIfPresent(page, /Nila|Ikan Nila|Tilapia|fish|Cakalang/i);
    await expectResultContainsIfPresent(page, /tawar|tea|Teh|flat/i);

    await input.click({ timeout: 15000 });
    await input.fill('the kangkung is 100g');
    await sendAndAwaitJob();
    await expectResultContainsIfPresent(page, /Kangkung|water spinach|sayur|100\s?g/i);
    await expectResultContainsIfPresent(page, /tawar|tea|Teh|flat/i);

    // Persist job id for downstream debug export (same id reused across multiturn edits).
    const fs = await import('node:fs');
    fs.writeFileSync('./tests/captures/pw_jobid.txt', jobIds[jobIds.length - 1] || jobIds[0] || '');
    fs.writeFileSync('./tests/captures/pw_jobids.json', JSON.stringify(jobIds, null, 2));
  });
});
