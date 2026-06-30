import { test, expect } from '@playwright/test';

const USER = process.env.E2E_USER ?? 'me';
const PASS = process.env.E2E_PASS ?? 'pw1234567';

test('add a Slack notifier and run a test', async ({ page }) => {
  let created = false;
  await page.route('**/api/notifiers', async (route) => {
    if (route.request().method() === 'POST') {
      created = true;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'n1', type: 'slack', name: 'team-ch', enabled: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: created
          ? [
              {
                id: 'n1',
                type: 'slack',
                name: 'team-ch',
                enabled: true,
                host: '',
                port: 0,
                secure: false,
                from: '',
                to: '',
                subjectTemplate: '',
                hasSecret: true,
              },
            ]
          : [],
      }),
    });
  });
  await page.route('**/api/notifiers/n1/test', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );

  await page.goto('/login');
  await page.getByLabel(/username/i).fill(USER);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();

  await page.goto('/notifications');
  await page.getByRole('button', { name: /add notifier/i }).click();
  await page.getByLabel('Type').selectOption('slack');
  await page.getByLabel(/name/i).fill('team-ch');
  await page.getByLabel(/webhook url/i).fill('https://hooks.slack.com/X');
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByText('team-ch')).toBeVisible();
  await page.getByRole('button', { name: /send test/i }).click();
  await expect(page.getByText(/test sent/i)).toBeVisible();
});
