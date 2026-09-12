import { test, expect } from '@playwright/test';

/**
 * S-10 PORTION_FUNNEL — stubbed portion-clarify journey (no live Gemini):
 * - awaiting_user job with a portionClarify payload renders the picker with options.
 * - Picking the photo estimate + Confirm retires the picker locally (Path A,
 *   no agent resubmit) without page errors.
 */
test.describe('S-10: Portion funnel clarify journey', () => {
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

  test('picker appears on clarify, confirm retires it locally', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

    let activeJobId = '';
    await page.route('**/api/jobs/submit', async (route) => {
      let postData: any = {};
      try {
        postData = JSON.parse(route.request().postData() || '{}');
      } catch (e) {}
      activeJobId = postData.jobId || 'job_stub_clarify_1';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, jobId: activeJobId, status: 'running', message: 'Job submitted successfully' }),
      });
    });

    const clarifyPayload = {
      promptMessage: 'How much of “Indomaret Kacang Kulit” did you eat? (Label is per 100g — pick a portion so we don’t guess.)',
      items: [
        {
          scoutIndex: 2,
          name: 'Indomaret Kacang Kulit',
          estimatedWeightGrams: 100,
          packGrams: 110,
          labelServingGrams: 100,
          options: [
            { id: 'photo_100', label: 'Portion in dish (100g)', weightGrams: 100 },
            { id: 'pack_110', label: 'Whole pack (110g)', weightGrams: 110 },
            { id: 'panel_100', label: '100g (nutrition panel basis)', weightGrams: 100 },
          ],
          reason: 'Package weight (110g) differs from estimated portion (100g) — confirm how much you ate',
        },
      ],
      scoutItems: [],
    };

    await page.route('**/api/jobs/status*', async (route) => {
      const url = new URL(route.request().url());
      const reqJobId = url.searchParams.get('jobId') || activeJobId || 'job_stub_clarify_1';
      const nowIso = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [
            {
              id: reqJobId,
              status: 'awaiting_user',
              created_at: nowIso,
              updated_at: nowIso,
              clean_result: {
                pendingFoodLog: {
                  name: 'Indomaret Kacang Kulit',
                  weightGrams: 100,
                  nutrients: { calories: 607, protein: 8.9, carbohydrates: 28.6, totalFat: 46.4 },
                  itemsBreakdown: [],
                },
                portionClarify: clarifyPayload,
              },
            },
          ],
        }),
      });
    });

    // Open Log Meal chat dialog (same affordances as dialog-inventory).
    const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await quickActionBtn.waitFor({ state: 'visible', timeout: 10000 });
    await quickActionBtn.click();

    const logMealBtn = page.getByRole('button', { name: /Log Meal/i }).first();
    await logMealBtn.waitFor({ state: 'visible', timeout: 5000 });
    await logMealBtn.click();

    const textInputs = page.locator('textarea, input[placeholder*="eat" i], input[placeholder*="message" i]').first();
    await expect(textInputs).toBeVisible({ timeout: 10000 });
    await textInputs.fill('kacang kulit');

    const sendBtn = page.locator('button[type="submit"], button:has(svg.lucide-arrow-up), button:has(svg.lucide-send)').first();
    await sendBtn.click();

    // Submit closes the dialog (onJobEnqueued); the Food tab job card offers
    // Select Portion once the stubbed awaiting_user poll lands. Reopen the
    // meal dialog through it — the real user journey.
    const selectPortionBtn = page.getByRole('button', { name: /Select Portion/i }).first();
    await expect(selectPortionBtn).toBeVisible({ timeout: 20000 });
    await selectPortionBtn.click();

    // Picker renders with the stubbed options.
    const prompt = page.getByText(/How much of.*Kacang Kulit/i).first();
    await expect(prompt).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Whole pack \(110g\)/ }).first()).toBeVisible({ timeout: 5000 });

    // Pick the photo estimate (within tolerance → local Path A, no resubmit).
    await page.getByRole('button', { name: /Portion in dish \(100g\)/ }).first().click();
    await page.getByRole('button', { name: /Confirm portions \(Instant Update\)/ }).first().click();

    // Picker retires; no crash.
    await expect(prompt).not.toBeVisible({ timeout: 10000 });
    expect(pageErrors).toEqual([]);
  });
});
