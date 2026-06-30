import { test, expect } from '@playwright/test';

const USER = process.env.E2E_USER ?? 'me';
const PASS = process.env.E2E_PASS ?? 'pw1234567';

test('add a JIRA site via the Sources tab', async ({ page }) => {
  await page.route('**/api/jira/sites', async (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 's1',
          baseUrl: 'https://acme.atlassian.net',
          email: 'me@x.com',
          enabled: true,
          hasToken: true,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/login');
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.goto('/sources');
  await page.getByRole('tab', { name: 'JIRA' }).click();
  await page.getByRole('button', { name: /add jira site/i }).click();
  await page.getByLabel(/base url/i).fill('https://acme.atlassian.net');
  await page.getByLabel(/email/i).fill('me@x.com');
  await page.getByLabel(/api token/i).fill('tok12345');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText('acme.atlassian.net')).toBeVisible();
});
