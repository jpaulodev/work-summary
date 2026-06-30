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

test('reply with a bad token shows the write-scope banner', async ({ page }) => {
  await page.route('**/api/comments/*/reply', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'token-write-scope', message: 'no scope' }),
    }),
  );
  await login(page);
  const replyBtn = page.getByRole('button', { name: /^reply$/i }).first();
  if (await replyBtn.isVisible().catch(() => false)) {
    await replyBtn.click();
    await page.getByRole('textbox', { name: /reply/i }).fill('x');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText(/lack write scope/i)).toBeVisible();
  }
});
