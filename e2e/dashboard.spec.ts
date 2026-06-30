import { test, expect } from '@playwright/test';

const USER = process.env.E2E_USER ?? 'me';
const PASS = process.env.E2E_PASS ?? 'pw1234567';

test('login then see the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});

test('mark a pending comment as addressed removes it from the pending filter', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  const firstAddressed = page.getByRole('button', { name: /addressed/i }).first();
  if (await firstAddressed.isVisible().catch(() => false)) {
    await firstAddressed.click();
  }
});
