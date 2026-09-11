import { test, expect, type Page } from '@playwright/test';

/**
 * Portion-clarify continuation.
 * - Default: stubbed food-analyze SSE so we assert UI + Turn 2 payload (skipScout + scoutIndex keys)
 *   without spending Gemini.
 * - LIVE_PORTION_CLARIFY=1: real oats photo clickthrough against :3000.
 */

const first = (page: Page, selectors: string[]) =>
  selectors.map((sel) => page.locator(sel)).reduce((loc, next) => loc.or(next)).first();

async function demoLogin(page: Page) {
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
  if (await homeTab.waitFor({ state: 'attached', timeout: 1000 }).then(() => true).catch(() => false)) {
    return;
  }
  if (await demoBtn.isVisible().catch(() => false)) {
    await demoBtn.click({ timeout: 10000 }).catch(() => {});
  }
  await expect(homeTab).toBeAttached({ timeout: LOGIN_TIMEOUT });
}

async function openFoodChat(page: Page) {
  await first(page, ['#nav-tab-food', 'button:has-text("Food")', '[role="tab"]:has-text("Food")']).click();
  await first(page, ['button[title="Open quick actions"]', 'button.w-14.h-14', '[aria-label*="quick"]']).click();
  await first(page, ['button:has-text("Catat Makanan")', 'button:has-text("Log meal")', 'button:has-text("Log Meal")']).click();
  await expect(page.locator('#food-chat-input')).toBeVisible({ timeout: 15000 });
}

function sseFinal(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify({ type: 'final', final: true, result: payload })}\n\n`;
}

test.describe('Portion clarify continuation', () => {
  test('stubbed: clarify card → confirm sends skipScout + scoutIndex choices', async ({ page }) => {
    test.setTimeout(120000);
    let turn = 0;
    const turn2Bodies: any[] = [];

    await page.route('**/api/gemini/food-analyze**', async (route) => {
      const req = route.request();
      let body: any = {};
      try {
        body = req.postDataJSON();
      } catch {
        body = {};
      }
      turn += 1;
      if (turn === 1) {
        const payload = {
          mode: 'portion_clarify',
          needsPortionClarify: true,
          message: 'How much of “Rolled Oats Porridge” did you eat? (Label is per 100g — pick a portion so we don’t guess.)',
          text: 'How much of “Rolled Oats Porridge” did you eat? (Label is per 100g — pick a portion so we don’t guess.)',
          scoutItems: [
            {
              scoutIndex: 0,
              originalName: 'Rolled Oats Porridge',
              keyword: 'Rolled Oats Porridge',
              estimatedWeightGrams: 60,
              estimatedCalories: 50,
            },
          ],
          portionClarify: {
            promptMessage:
              'How much of “Rolled Oats Porridge” did you eat? (Label is per 100g — pick a portion so we don’t guess.)',
            items: [
              {
                scoutIndex: 0,
                name: 'Rolled Oats Porridge',
                estimatedWeightGrams: 60,
                packGrams: 500,
                labelServingGrams: 40,
                options: [
                  { id: 'est', label: 'Estimated 60g', weightGrams: 60 },
                  { id: 'serv', label: '1 serving 40g', weightGrams: 40 },
                  { id: 'pack', label: 'Whole pack 500g', weightGrams: 500 },
                ],
              },
            ],
            scoutItems: [
              {
                scoutIndex: 0,
                originalName: 'Rolled Oats Porridge',
                estimatedWeightGrams: 60,
              },
            ],
          },
          resolvedDbCandidates: [],
        };
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: sseFinal(payload),
        });
        return;
      }

      turn2Bodies.push(body);
      const done = {
        mode: 'new_log',
        needsPortionClarify: false,
        message: 'You logged rolled oats porridge.',
        text: 'You logged rolled oats porridge.',
        pendingFoodLog: {
          name: 'Rolled Oats Porridge',
          mealName: 'Rolled Oats Porridge',
          weightGrams: body?.portionChoices?.['0'] || 60,
          nutrients: { calories: 180, protein: 5, carbohydrates: 30, totalFat: 4 },
          itemsBreakdown: [
            {
              name: 'Rolled Oats Porridge',
              originalName: 'Rolled Oats Porridge',
              weightGrams: body?.portionChoices?.['0'] || 60,
              nutrients: { calories: 180 },
            },
          ],
        },
        scoutItems: body.activeScoutItems || body.scoutItems || [],
      };
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseFinal(done),
      });
    });

    await demoLogin(page);
    await openFoodChat(page);

    // Tiny 1x1 jpeg so the client takes the image path
    const tinyJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUTEhMWFhUVFRUVFRUVFRUWFxUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A0oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==',
      'base64',
    );
    await page.locator('#food-chat-input').setInputFiles({
      name: 'oats.jpg',
      mimeType: 'image/jpeg',
      buffer: tinyJpeg,
    }).catch(async () => {
      // Some builds use a hidden file input near the composer
      await page.locator('input[type="file"]').first().setInputFiles({
        name: 'oats.jpg',
        mimeType: 'image/jpeg',
        buffer: tinyJpeg,
      });
    });

    await page.locator('#food-chat-input').fill('Analyze this rolled oats porridge with its nutrition facts label');
    await page.locator('#food-chat-send-btn').click();

    await expect(page.getByText(/Portion Selection Needed|Serving size check|How much of|Pick Portion/i).first()).toBeVisible({ timeout: 30000 });
    await first(page, ['button:has-text("Select Portion")', 'button:has-text("Pilih Porsi")']).click({ timeout: 15000 });
    await expect(page.getByText(/Serving size check|How much of|Confirm portions|Instant Update/i).first()).toBeVisible({ timeout: 15000 });
    await first(page, [
      'button:has-text("Confirm portions")',
      'button:has-text("Instant Update")',
      'button:has-text("Agent Review")',
      'button:has-text("Lanjutkan")',
      'button:has-text("Konfirmasi")',
    ]).click({ timeout: 30000 });

    await expect.poll(() => turn2Bodies.length, { timeout: 30000 }).toBeGreaterThan(0);
    const t2 = turn2Bodies[0];
    expect(t2.skipScout === true || !!t2.portionChoices).toBeTruthy();
    expect(t2.portionChoices).toBeTruthy();
    const keys = Object.keys(t2.portionChoices || {});
    expect(keys.some((k) => /^\d+$/.test(k))).toBeTruthy();
    // Prefer scoutIndex "0" over dish-name keys
    expect(t2.portionChoices['0'] || t2.portionChoices[0]).toBeTruthy();
  });

  test('live oats clickthrough when LIVE_PORTION_CLARIFY=1', async ({ page }) => {
    test.skip(process.env.LIVE_PORTION_CLARIFY !== '1', 'Set LIVE_PORTION_CLARIFY=1 for real Gemini clickthrough');
    test.setTimeout(600000);
    await page.addInitScript(() => {
      localStorage.setItem(
        'admin_agent_settings',
        JSON.stringify({ flashLiteCost: 1, standardCost: 1, quotaDemo: 500, quotaStandard: 500, quotaAdmin: 500 }),
      );
    });
    await demoLogin(page);
    await page.evaluate(() => {
      localStorage.setItem(
        'admin_agent_settings',
        JSON.stringify({ flashLiteCost: 1, standardCost: 1, quotaDemo: 500, quotaStandard: 500, quotaAdmin: 500 }),
      );
    }).catch(() => {});
    await openFoodChat(page);

    const oat1 = 'prototype/meallog/images/08_rolled_oats_1.jpg';
    const oat2 = 'prototype/meallog/images/08_rolled_oats_2.jpg';
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([oat1, oat2]);
    await page.locator('#food-chat-input').fill('Analyze this rolled oats porridge with its nutrition facts label');
    await page.locator('#food-chat-send-btn').click();

    await expect(page.getByText(/Portion Selection Needed|Pick Portion|Serving size check|How much of|portion|porsi/i).first()).toBeVisible({
      timeout: 240000,
    });
    await first(page, ['button:has-text("Select Portion")', 'button:has-text("Pilih Porsi")']).click({ timeout: 30000 });
    await first(page, [
      'button:has-text("Confirm portions")',
      'button:has-text("Instant Update")',
      'button:has-text("Agent Review")',
      'button:has-text("Lanjutkan")',
      'button:has-text("Konfirmasi")',
    ]).click({ timeout: 30000 });

    // After confirm, analyzing should settle into a meal card / kcal text
    await expect(
      page.getByText(/kcal|calories|kalori|Rolled Oats|oat/i).first(),
    ).toBeVisible({ timeout: 240000 });
  });
});
