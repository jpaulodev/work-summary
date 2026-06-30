import { test, expect } from '@playwright/test';

const USER = process.env.E2E_USER ?? 'me';
const PASS = process.env.E2E_PASS ?? 'pw1234567';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
}

test('create a schedule then see it in the list', async ({ page }) => {
  await login(page);
  await page.goto('/schedules');
  await page.getByRole('button', { name: /new schedule/i }).click();
  await page.getByLabel('Name').fill('weekday-9');
  await page.getByRole('button', { name: /every weekday at 9 am/i }).click();
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByText('weekday-9')).toBeVisible();
  await expect(page.getByText('0 9 * * 1-5')).toBeVisible();
});
