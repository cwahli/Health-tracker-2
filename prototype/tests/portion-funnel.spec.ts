import { test, expect } from '@playwright/test';
import {
  detectPortionAmbiguity,
  detectPackNetWeightGrams,
  resolveItemQuantities,
} from '../../server_portion_clarify';

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

test.describe('S-10: live debug-file regression cases (real funnel, no stubs)', () => {
  /**
   * Case 1 — debug-job_1789171414373: photo-only log, scout est 28g on a
   * 180g "Berat Bersih" pack, label without serving fields. Shipped silent
   * (28g locked, no question). The funnel must ASK.
   */
  test('case-1 silent 28g pack item now asks', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Kacang Kulit',
        keyword: 'Kacang Kulit',
        estimatedWeightGrams: 28,
        source: 'visual',
        packageLabelText: 'Indomaret Kacang Kulit Berat Bersih 180 g',
        rawNutritionLabel: { calories: 170, protein: 2.5, sodium: 135 },
      },
      {
        scoutIndex: 1,
        originalName: 'Fried Chicken Drumstick',
        keyword: 'Fried Chicken Drumstick',
        estimatedWeightGrams: 120,
        source: 'visual',
      },
      {
        scoutIndex: 2,
        originalName: 'Larutan Cap Kaki Tiga Cooltopia Melon Orange',
        keyword: 'Larutan Cap Kaki Tiga Cooltopia Melon Orange',
        estimatedWeightGrams: 320,
        packGrams: 320,
        source: 'visual',
      },
    ];

    // Root cause of the shipped silence: the old detector had no sticker-text
    // cue, so with no packGrams FIELD it found no pack and bailed on the
    // visual early-return. The cue now derives the pack from the OCR text.
    expect(detectPackNetWeightGrams(items[0])).toBe(180);
    expect(detectPortionAmbiguity(items[0], 0)).not.toBeNull();

    const funnel = resolveItemQuantities(items, { userText: '' });
    expect(funnel.clarifyItems.length).toBe(1);
    expect(funnel.clarifyItems[0].name).toMatch(/kacang/i);
    const weights = funnel.clarifyItems[0].options.map((o) => o.weightGrams);
    expect(weights).toContain(28);
    expect(weights).toContain(90);
    const res = funnel.resolutions.find((r) => r.scoutIndex === 0);
    expect(res?.decision).toBe('ask');

    // Siblings stay silent: chicken has no pack divergence, the 320ml drink
    // equals its single-serve pack (CORE LAW) — no over-asking.
    expect(funnel.clarifyItems.some((i) => i.scoutIndex === 1)).toBe(false);
    expect(funnel.clarifyItems.some((i) => i.scoutIndex === 2)).toBe(false);
  });

  /**
   * Case 2 — debug-job_1789171484121: user said "I had 100g of kacang",
   * scout est 100g on the 180g pack. Shipped a REDUNDANT question.
   * The funnel must stay silent and adopt the stated 100g.
   */
  test('case-2 stated 100g matching est stays silent', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Fried Chicken Drumstick',
        keyword: 'Fried Chicken Drumstick',
        estimatedWeightGrams: 100,
        source: 'visual',
      },
      {
        scoutIndex: 1,
        originalName: 'Cooltopia Melon Orange Drink',
        keyword: 'Cooltopia Melon Orange',
        estimatedWeightGrams: 320,
        packGrams: 320,
        source: 'visual',
      },
      {
        scoutIndex: 2,
        originalName: 'Indomaret Kacang Kulit',
        keyword: 'Indomaret Kacang Kulit',
        estimatedWeightGrams: 100,
        source: 'visual',
        packageLabelText: 'Berat Bersih: 180 g',
      },
    ];

    // The detector still fires on these grams WITHOUT user context (it never
    // sees user text) — the shipped bug was asking DESPITE the stated 100g.
    // The funnel suppresses it.
    expect(detectPortionAmbiguity(items[2], 2)).not.toBeNull();

    const funnel = resolveItemQuantities(items, { userText: 'I had 100g of kacang' });
    expect(funnel.clarifyItems.length).toBe(0);
    const res = funnel.resolutions.find((r) => r.scoutIndex === 2);
    expect(res?.decision).toBe('accept-stated');
    expect(funnel.items[2].estimatedWeightGrams).toBe(100);
    expect(funnel.items[2].statedGramsAdopted).toBe(true);
  });

  /**
   * Case 3 — debug-job_1789201936859 (live repro of case 1): est "28"
   * (string, as the scout emits), sticker-only pack evidence, no user text.
   * Must ASK with the live option set.
   */
  test('case-3 live 28g repro asks with pack halves', () => {
    const items = [
      {
        scoutIndex: 0,
        originalName: 'Indomaret Kacang Kulit',
        keyword: 'Indomaret Kacang Kulit',
        estimatedWeightGrams: '28',
        source: 'visual',
        packageLabelText: 'Kacang Kulit Berat Bersih 180 g',
        rawNutritionLabel: { calories: 170, protein: 3.6, sodium: 0 },
      },
    ];
    const funnel = resolveItemQuantities(items, {});
    expect(funnel.clarifyItems.length).toBe(1);
    const weights = funnel.clarifyItems[0].options.map((o) => o.weightGrams);
    expect(weights).toEqual(expect.arrayContaining([28, 90, 45, 100]));
  });
});
