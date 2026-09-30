import { test, expect } from '@playwright/test';

test('login and registration offer a visible route back home', async ({ page }) => {
  for (const route of ['/login', '/register']) {
    await page.goto(route);
    await page.getByRole('link', { name: 'Back to home', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Care that sees');
  }
});

test('doctor results sit immediately below search and paginate with filter resets', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const cards = page.getByRole('link', { name: /View appointments with/ });
  await expect(cards).toHaveCount(3);
  const firstPage = await cards.evaluateAll((links) =>
    links.map((link) => link.getAttribute('aria-label')),
  );
  await page.getByRole('button', { name: 'Explore doctors', exact: true }).click();
  await expect
    .poll(async () => Math.round((await page.locator('#doctor-results').boundingBox())!.y))
    .toBe(110);
  const search = await page
    .getByRole('button', { name: 'Explore doctors', exact: true })
    .locator('..')
    .boundingBox();
  const heading = await page.locator('#doctor-results').boundingBox();
  expect(heading!.y - (search!.y + search!.height)).toBeGreaterThanOrEqual(0);
  expect(heading!.y - (search!.y + search!.height)).toBeLessThan(65);
  await expect(page.getByRole('button', { name: 'Previous doctor results page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next doctor results page' }).click();
  await expect(cards).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Doctor results page 2', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Next doctor results page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous doctor results page' }).click();
  expect(
    await cards.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label'))),
  ).toEqual(firstPage);
  await page.getByRole('button', { name: 'Next doctor results page' }).click();
  await page.getByLabel('Clinic location', { exact: true }).selectOption('clinic-gulshan');
  await expect(
    page.getByRole('button', { name: 'Doctor results page 1', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(cards).toHaveCount(3);
  await page.getByRole('button', { name: 'Next doctor results page' }).click();
  await page.getByLabel('Specialty', { exact: true }).selectOption('Cardiology');
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Dr. Sara Ahmed', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Doctor result pages' })).toHaveCount(0);
});

test('public doctor discovery filters by specialty and clinic without signing in', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Care that sees');
  await expect(page.getByRole('heading', { name: 'Dr. Imran Hasan', exact: true })).toBeVisible();
  await page.getByLabel('Specialty', { exact: true }).selectOption('Cardiology');
  await page.getByLabel('Clinic location', { exact: true }).selectOption('clinic-gulshan');
  await page.getByRole('button', { name: 'Explore doctors', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dr. Sara Ahmed', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dr. Imran Hasan', exact: true })).toHaveCount(0);
  await expect(page.getByText('1 doctor at Gulshan Health Studio', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dr. Imran Hasan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore doctors at Dhanmondi Care Center' }).click();
  await expect(page.getByLabel('Clinic location', { exact: true })).toHaveValue('clinic-dhanmondi');
});
test('care journey supports keyboard tabs and FAQ answers expand', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'During your visit', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Follow your position after check-in');
  await page.getByRole('tab', { name: 'During your visit', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'After your visit', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Good care keeps going.');
  await page.getByText('Who can see my health records?', { exact: true }).click();
  await expect(page.locator('details[open]')).toHaveCount(1);
  await expect(page.locator('details[open]')).toContainText('time-limited access');
});
test('a doctor selected on the landing page survives the sign-in step', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('link', { name: 'View appointments with Dr. Sara Ahmed', exact: true })
    .click();
  await expect(page).toHaveURL(/login\?next=/);
  await page.getByRole('button', { name: 'Patient', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/doctors\?doctor=doctor-sara/);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Dr. Sara Ahmed');
});
test('landing layouts have no overflow, working mobile navigation and minimum 14px text', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dr. Sara Ahmed', exact: true })).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px overflow`,
    ).toBeTruthy();
    const tiny = await page.getByTestId('landing-page').evaluate((root) =>
      Array.from(root.querySelectorAll('*'))
        .filter(
          (e) =>
            e.getClientRects().length &&
            Array.from(e.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
            ) &&
            parseFloat(getComputedStyle(e).fontSize) < 14,
        )
        .map((e) => ({ text: e.textContent?.slice(0, 60), font: getComputedStyle(e).fontSize })),
    );
    expect(tiny, `${width}px typography`).toEqual([]);
  }
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/landing-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'FAQs', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: 'artifacts/landing-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
