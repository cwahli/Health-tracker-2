import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Live UI verify (demo) — mirrors Grok Bot browser checks.
 * Default: shell + open food chat (no Gemini soak).
 * Set LIVE_MEAL_EDIT=1 to also upload photo + two edits (slow, spends Gemini).
 */
test.describe('Live multiturn meal edit (demo)', () => {
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

  test('demo shell loads and food chat opens (multiturn-meal-edit.live)', async ({ page }) => {
    await expect(page.locator('#nav-tab-food')).toBeAttached();
    const plus = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await plus.click();
    const logMeal = page.getByText(/Catat Makanan|Log meal|Log Meal/i).first();
    await expect(logMeal).toBeVisible({ timeout: 10000 });
    await logMeal.click();
    const input = page.locator('#food-chat-input, input[name="food-chat-input"]').first();
    await expect(input).toBeVisible({ timeout: 15000 });
  });

  test('optional live meal edits when LIVE_MEAL_EDIT=1', async ({ page }) => {
    test.skip(process.env.LIVE_MEAL_EDIT !== '1', 'Set LIVE_MEAL_EDIT=1 to run photo+edit soak');
    const photo = process.env.LIVE_MEAL_PHOTO || '/workspace/meal-tawar-nilai-web.jpg';
    const plus = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
    await plus.click();
    await page.getByText(/Catat Makanan|Log meal|Log Meal/i).first().click();
    const input = page.locator('#food-chat-input, input[name="food-chat-input"]').first();
    await expect(input).toBeVisible({ timeout: 15000 });

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(photo);
    await page.locator('#food-chat-send-btn').click();
    // Wait for analyze to leave "Analyzing"/Updating — generous timeout
    await expect(page.getByText(/Updating|Analyzing|Menganalisis|Memperbarui/i)).toBeHidden({ timeout: 180000 }).catch(() => {});
    await input.fill('the tea is tawar and the fish is nilai');
    await page.locator('#food-chat-send-btn').click();
    await page.waitForTimeout(5000);
    await expect(input).toBeEnabled({ timeout: 180000 });
    await input.fill('the kangkung is 100g');
    await page.locator('#food-chat-send-btn').click();
    await expect(input).toBeEnabled({ timeout: 180000 });
    // Soft asserts — strengthen as Qwen iterates
    await expect(page.locator('body')).toContainText(/Teh|Tawar|Kangkung|Nila|Cakalang/i, { timeout: 10000 });
  });
});
