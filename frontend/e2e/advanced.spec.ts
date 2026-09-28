import { test, expect, Page } from '@playwright/test';
import { io } from 'socket.io-client';
async function login(page: Page, role = 'Patient') {
  await page.goto('/login');
  await page.getByRole('button', { name: role, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
}
test('authenticated realtime connection is revoked when its device signs out', async ({ page }) => {
  await login(page);
  const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const socket = io('http://localhost:3000/ws', {
    path: '/api/socket.io',
    addTrailingSlash: false,
    transports: ['polling'],
    extraHeaders: { Cookie: cookies },
    timeout: 5000,
    reconnection: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime connection timed out')), 8000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const disconnected = new Promise<string>((resolve) => socket.once('disconnect', resolve));
    const response = await page.request.post('/api/auth/logout', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(response.ok()).toBeTruthy();
    expect(
      await Promise.race([
        disconnected,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Device socket remained active')), 5000),
        ),
      ]),
    ).toBe('io server disconnect');
  } finally {
    socket.disconnect();
  }
});
test('patient care tasks persist and reviewed laboratory results are visible', async ({ page }) => {
  await login(page);
  await page.goto('/care-plans');
  await expect(
    page.getByRole('heading', { name: 'Your wellbeing, one step at a time' }),
  ).toBeVisible();
  const task = page.getByRole('checkbox', { name: /Keep a daily wellbeing journal/ });
  const original = await task.isChecked();
  await task.setChecked(!original);
  await expect(task).toBeChecked({ checked: !original });
  await expect(task).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Keep a daily wellbeing journal/ })).toBeChecked({
    checked: !original,
  });
  await page.getByRole('checkbox', { name: /Keep a daily wellbeing journal/ }).setChecked(original);
  await expect(
    page.getByRole('checkbox', { name: /Keep a daily wellbeing journal/ }),
  ).toBeEnabled();
  await page.goto('/clinical');
  await expect(page.getByRole('heading', { name: 'Routine screening (synthetic)' })).toBeVisible();
  await expect(page.getByText('Hemoglobin', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Referrals/ }).click();
  await expect(
    page.getByRole('heading', { name: 'General Medicine referral', exact: true }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Verified phone sign-in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Doctor-specific consent' })).toBeVisible();
});
test('doctor calendar queue and reversible schedule impact preview work', async ({ page }) => {
  await login(page, 'Doctor');
  await page.goto('/calendar');
  await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible();
  await page.goto('/queue');
  await expect(page.getByRole('heading', { name: 'A smoother day of care.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Call next patient' })).toBeVisible();
  await page.goto('/schedules');
  await page.getByRole('button', { name: 'Edit rule', exact: true }).first().click();
  await page.getByRole('button', { name: 'Preview impact', exact: true }).click();
  await expect(page.getByText(/existing visits.*(review|preview)/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('administrator finance ledger export and background worker are available', async ({
  page,
}) => {
  await login(page, 'Admin');
  await page.getByRole('combobox', { name: 'Active clinic' }).selectOption('clinic-dhanmondi');
  await page.goto('/finance');
  await expect(
    page.getByRole('heading', { name: 'A clearer picture of every taka.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Billing policy' })).toBeVisible();
  const response = await page.request.get('/api/finance/clinic/clinic-dhanmondi/export');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('text/csv');
  await page.screenshot({
    path: 'artifacts/finance-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto('/jobs');
  await expect(page.getByText('Worker is running', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background jobs', exact: true })).toBeVisible();
});
test('advanced patient screens fit mobile and visible text stays at least 14px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const route of ['/calendar', '/care-plans', '/clinical', '/settings']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.skeleton').first()).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const tiny = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main *'))
        .filter(
          (e) =>
            e.getClientRects().length &&
            Array.from(e.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
            ) &&
            parseFloat(getComputedStyle(e).fontSize) < 14,
        )
        .map((e) => ({ text: e.textContent?.slice(0, 60), size: getComputedStyle(e).fontSize })),
    );
    expect(tiny, route).toEqual([]);
  }
  await page.screenshot({
    path: 'artifacts/security-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
