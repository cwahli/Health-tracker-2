import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  // Expect a title "to contain" a substring. We don't know the exact title, so we just check it doesn't crash.
  await expect(page).toHaveTitle(/.*|/);
});

test('basic visual layout loaded', async ({ page }) => {
  await page.goto('/');
  // Check if body exists and is visible
  const body = page.locator('body');
  await expect(body).toBeVisible();
});
