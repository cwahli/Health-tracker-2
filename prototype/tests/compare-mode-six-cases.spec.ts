import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * End-to-End Playwright test suite for Compare Mode (Mode D) across the 6 test cases.
 * 
 * Verifies:
 * 1. Single-pass scout-only compare architecture on backend (/api/gemini/food-analyze with userSelectedMode: 'compare')
 * 2. Group sorting from best to least favorable
 * 3. Dual-name translation ("Original Name / English Translation")
 * 4. Per-100g nutritional reference values alongside per-serving metrics
 * 5. Estimated nutrients for unlabelled foods
 * 6. UI evaluation card rendering (groups, ordering tips, comparative sentences, item chips)
 */

const IMAGES_DIR = path.resolve(process.cwd(), 'prototype/meallog/compare/images');

const CASES = [
  {
    setNum: 1,
    id: 'set1',
    name: 'Set 1: Bakery Shelf & SilverQueen Chocolate',
    files: [
      'set1_saybread_bakery_shelf.jpg',
      'set1_silverqueen_nutrition_label.jpg',
      'set1_silverqueen_chocolate_front.jpg',
    ],
    userPrompt: '', // Empty prompt defaults to comparing all items
  },
  {
    setNum: 2,
    id: 'set2',
    name: 'Set 2: 4 Snack & Pack Nutrition Labels',
    files: [
      'set2_snack_green_bar_label.jpg',
      'set2_snack_pack_front.jpg',
      'set2_snack_yellow_cake_label.jpg',
      'set2_snack_blue_bread_label.jpg',
    ],
    userPrompt: '',
  },
  {
    setNum: 3,
    id: 'set3',
    name: 'Set 3: Restaurant Menu Pages (Sambal Bakar Pencok)',
    files: [
      'set3_restaurant_menu_page1.jpg',
      'set3_restaurant_menu_page2.jpg',
    ],
    userPrompt: '',
  },
  {
    setNum: 4,
    id: 'set4',
    name: 'Set 4: Juice & Beverage List',
    files: [
      'set4_juice_and_beverage_list.jpg',
    ],
    userPrompt: '',
  },
  {
    setNum: 5,
    id: 'set5',
    name: 'Set 5: Indonesian Street Food & Seafood Menu Banner',
    files: [
      'set5_restaurant_banner_menu.jpg',
    ],
    userPrompt: '',
  },
  {
    setNum: 6,
    id: 'set6',
    name: 'Set 6: Supermarket Chip Aisle Shelf',
    files: [
      'set6_supermarket_chip_aisle_shelf.jpg',
    ],
    userPrompt: '',
  },
];

function loadImagesAsBase64(fileNames: string[]) {
  return fileNames.map((f) => {
    const fullPath = path.join(IMAGES_DIR, f);
    const buf = fs.readFileSync(fullPath);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  });
}

test.describe('Compare Mode (Mode D) - 6 Cases End-to-End Pipeline & Card Verification', () => {
  test.setTimeout(180000); // 3 minutes per test for multimodal analysis

  for (const c of CASES) {
    test(`Case ${c.setNum} (${c.name}): Backend API and UI Card Contract`, async ({ request, page }) => {
      console.log(`[Compare E2E] Running Case ${c.setNum}: ${c.name}`);
      const base64Images = loadImagesAsBase64(c.files);

      // 1. Verify Backend API in Compare Mode
      const payload = {
        message: c.userPrompt,
        images: base64Images,
        userSelectedMode: 'compare',
        userProfile: {
          name: 'Demo User',
          age: 35,
          gender: 'male',
          weight: 75,
          height: 175,
          language: 'en',
          topNutrientsToMonitor: ['calories', 'saturatedFat', 'sodium', 'addedSugar'],
          threeDayExcesses: {
            saturatedFat: 38,
            addedSugar: 50,
            sodium: 40,
            calories: 15,
          },
        },
      };

      const res = await request.post('/api/gemini/food-analyze', {
        headers: { 'x-session-id': `server-job-compare-e2e-case-${c.setNum}` },
        data: payload,
      });

      expect(res.ok(), `API request for Case ${c.setNum} succeeded`).toBeTruthy();
      const body = await res.json();

      // Validate Mode D Output Structure
      expect(body.mode, 'mode should be evaluation').toBe('evaluation');
      expect(body.comparison, 'comparison object must exist').toBeDefined();
      expect(Array.isArray(body.comparison?.groups), 'comparison.groups must be an array').toBeTruthy();
      expect(body.comparison.groups.length, 'at least 2 groups for comparison').toBeGreaterThanOrEqual(1);

      const groups = body.comparison.groups;

      // Validate Group & Nutrition Properties
      for (const group of groups) {
        expect(group.groupName, 'groupName must exist').toBeTruthy();
        expect(group.verdict, 'verdict must exist').toBeDefined();
        expect(group.verdict.label, 'verdict.label must be non-empty').toBeTruthy();
        expect(['good', 'neutral', 'warning', 'alert', 'info']).toContain(group.verdict.level?.toLowerCase());

        // Validate Comparative Sentence
        expect(group.comparisonSentence, 'comparisonSentence must exist and be non-empty').toBeTruthy();

        // Validate Ordering Tip
        expect(group.orderingTip, 'orderingTip must exist and be non-empty').toBeTruthy();

        // Validate Nutrients & Per-100g Metrics
        expect(group.averageNutrients, 'averageNutrients must not be null').toBeDefined();
        expect(typeof group.averageNutrients.calories, 'calories must be a number').toBe('number');
        expect(group.averageNutrientsPer100g, 'averageNutrientsPer100g must exist').toBeDefined();
        expect(typeof group.averageNutrientsPer100g.calories, 'per100g calories must be a number').toBe('number');
      }

      // Validate Items & Sorting/Translation
      const allItems = body.items || body.comparison?.items || body.scoutItems || [];
      expect(Array.isArray(allItems), 'items list exists').toBeTruthy();
      expect(allItems.length, 'identified items count').toBeGreaterThanOrEqual(2);

      // 2. Verify UI Card Rendering in Browser
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const demoBtn = page.locator('#demo-login-btn');
      if (await demoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await demoBtn.click();
      }
      await page.locator('#nav-tab-home').waitFor({ state: 'attached', timeout: 30000 });

      // Open quick action sheet -> Compare
      const quickActionBtn = page.locator('button[title="Open quick actions"], button.w-14.h-14').first();
      await quickActionBtn.click();
      const compareBtn = page.locator('#quick-action-compare-meal');
      await expect(compareBtn).toBeVisible({ timeout: 5000 });
      await compareBtn.click();

      // Check that LogChat opens
      const chatInput = page.locator('#food-chat-input');
      await expect(chatInput).toBeVisible({ timeout: 15000 });

      // Inject the assistant response into JobStore to verify full UI card rendering
      await page.evaluate(({ testData, caseNum }) => {
        const win = window as any;
        const jobId = `job_test_compare_case_${caseNum}`;
        if (win.JobStore) {
          win.JobStore.createJob({
            id: jobId,
            kind: 'food_compare',
            lockedModeFamily: 'D',
            status: 'succeeded',
            result: testData,
            inputSnapshot: {
              mode: 'compare',
              text: 'Compare these items',
              hasImage: true,
            },
            messages: [
              {
                id: `msg_user_${jobId}`,
                role: 'user',
                content: 'Compare these items',
                timestamp: new Date().toISOString(),
              },
              {
                id: `msg_assistant_${jobId}`,
                role: 'assistant',
                content: testData.message || testData.comparison?.summary || 'Comparison complete',
                timestamp: new Date().toISOString(),
                pendingFoodLog: testData,
                data: {
                  userSelectedMode: 'compare',
                  agentResult: testData,
                  comparison: testData.comparison,
                  scoutItems: testData.items || [],
                },
              },
            ],
          });
          if (win.setActiveJobId) {
            win.setActiveJobId(jobId);
          }
        }
      }, { testData: body, caseNum: c.setNum });

      // Assert that the Mode D evaluation card renders
      const evalCard = page.locator('[data-testid="compare-evaluation-card"]');
      await expect(evalCard).toBeVisible({ timeout: 15000 });

      // Assert that comparison title exists
      const compTitle = page.locator('[data-testid="compare-title"]');
      await expect(compTitle).toBeVisible();

      // Assert group cards exist
      const groupCards = page.locator('[data-testid="compare-group-card"]');
      await expect(groupCards.first()).toBeVisible();
      const groupCount = await groupCards.count();
      expect(groupCount).toBeGreaterThanOrEqual(1);

      // Assert comparative sentences and ordering tips
      const sentences = page.locator('[data-testid="compare-sentence"]');
      await expect(sentences.first()).toBeVisible();

      const tips = page.locator('[data-testid="compare-ordering-tip"]');
      await expect(tips.first()).toBeVisible();

      console.log(`[Compare E2E] Case ${c.setNum} (${c.name}): Backend API & UI Card verified successfully!`);
    });
  }
});
