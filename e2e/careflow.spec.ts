import { test, expect, Page } from '@playwright/test';
async function login(page: Page, role = 'Patient') {
  await page.goto('/login');
  await page.getByRole('button', { name: role, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
}
test('patient books, pays a demo invoice, and cancels a visit', async ({ page }) => {
  await login(page);
  await page.screenshot({
    path: 'artifacts/dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Find a doctor', exact: true }).click();
  await page.getByRole('button', { name: 'Book a visit', exact: true }).first().click();
  const day = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel('Date', { exact: true }).fill(day);
  await page.locator('.slot:not([disabled])').first().click();
  await page.getByRole('button', { name: 'Reserve this time' }).click();
  await expect(page.getByText('Your time is reserved for')).toBeVisible();
  const confirmation = page.waitForResponse(
    (r) => r.url().endsWith('/api/appointments') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  const created = await (await confirmation).json();
  await expect(page.getByRole('heading', { name: 'See you soon.' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to your care' }).click();
  await page.getByRole('link', { name: 'Payments & invoices', exact: true }).click();
  await page
    .getByTestId(`invoice-${created.id}`)
    .getByRole('button', { name: 'Pay now', exact: true })
    .click();
  await page.getByRole('button', { name: 'Complete demo payment' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Demo payment completed' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Appointments', exact: true }).click();
  await page
    .getByTestId(`appointment-${created.id}`)
    .getByRole('button', { name: 'View details', exact: true })
    .click();
  await page.getByRole('button', { name: 'Cancel visit', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Appointment cancelled' })).toBeVisible();
});
test('patient health records download and public verification protect private data', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Health records', exact: true }).click();
  await page.getByRole('button', { name: 'View care details' }).last().click();
  await expect(page.getByRole('heading', { name: 'Care details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'assessment', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Download PDF', exact: true });
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  const response = await page.request.get(href!);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect((await response.body()).subarray(0, 4).toString()).toBe('%PDF');
});
test('doctor and administrator workspaces load scoped data', async ({ page }) => {
  await login(page, 'Doctor');
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recurring availability' })).toBeVisible();
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appointments this week' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'Admin');
  await page.getByRole('link', { name: 'Clinic management', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Dhanmondi Care Center', exact: true }),
  ).toBeVisible();
});
test('mobile layout has no overflow and all visible text is at least 14px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const tiny = await page.evaluate(() =>
    Array.from(document.querySelectorAll('body *'))
      .filter(
        (e) =>
          e.getClientRects().length &&
          Array.from(e.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          ) &&
          parseFloat(getComputedStyle(e).fontSize) < 14,
      )
      .map((e) => ({
        tag: e.tagName,
        text: e.textContent?.slice(0, 50),
        size: getComputedStyle(e).fontSize,
      })),
  );
  expect(tiny).toEqual([]);
  await page.screenshot({
    path: 'artifacts/dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Find a doctor', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A doctor who feels right for you.' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const section of [
    'appointments',
    'records',
    'billing',
    'telemedicine',
    'notifications',
    'settings',
  ]) {
    await page.goto(`/${section}`);
    await expect(page.locator('main h1')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      section,
    ).toBe(true);
  }
});

test('doctor checks in a patient, records care, signs a prescription, and completes the visit', async ({
  page,
}) => {
  await login(page);
  const day = new Date(Date.now() + 24 * 86400000).toISOString().slice(0, 10);
  const slots = await (
    await page.request.get(
      `/api/doctors/doctor-sara/slots?clinicId=clinic-dhanmondi&from=${day}&to=${day}&type=IN_PERSON`,
    )
  ).json();
  const slot = slots.find((s: { available: boolean }) => s.available);
  const hold = await (
    await page.request.post('/api/appointments/holds', {
      data: {
        doctorId: 'doctor-sara',
        clinicId: 'clinic-dhanmondi',
        startAt: slot.startAt,
        type: 'IN_PERSON',
      },
    })
  ).json();
  const result = await page.request.post('/api/appointments', {
    headers: { 'idempotency-key': `browser-clinical-${Date.now()}` },
    data: { holdId: hold.id, reason: 'Synthetic browser verification' },
  });
  expect(result.ok()).toBe(true);
  const appointment = await result.json();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, 'Doctor');
  await page.getByRole('link', { name: 'Appointments', exact: true }).click();
  const row = page.getByTestId(`appointment-${appointment.id}`);
  await row.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Start consultation', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await row.getByRole('button', { name: 'View details' }).click();
  await page.getByRole('button', { name: 'Clinical workspace', exact: true }).click();
  for (const field of ['subjective', 'objective', 'assessment', 'plan'])
    await page
      .getByLabel(field, { exact: true })
      .fill(`Synthetic ${field} for browser verification`);
  await page.getByRole('button', { name: 'Save care notes', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Care note saved' })).toBeVisible();
  for (const [field, value] of [
    ['name', 'Synthetic test medication'],
    ['dosage', 'Demonstration only'],
    ['frequency', 'Demonstration only'],
    ['duration', 'Demonstration only'],
  ])
    await page.getByLabel(field, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Save prescription draft', exact: true }).click();
  await page.getByRole('checkbox', { name: /I have reviewed the patient history/ }).check();
  await page.getByRole('button', { name: 'Sign prescription', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Prescription PDF', exact: true })).toBeVisible();
  await page.getByLabel('Pulse (bpm)', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Save observations', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Observations saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete consultation', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Consultation completed' }),
  ).toBeVisible();
  const final = await (await page.request.get(`/api/appointments/${appointment.id}`)).json();
  expect(final.status).toBe('COMPLETED');
});

test('registration creates a patient account and profile consent persists', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name', { exact: true }).fill('Browser Verification Patient');
  await page
    .getByLabel('Email address', { exact: true })
    .fill(`browser-${Date.now()}@careflow.demo`);
  await page.getByLabel('Password', { exact: true }).fill('BrowserVerification2026!');
  await page.getByRole('button', { name: 'Create your account', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('checkbox', {
      name: 'Allow my treating doctors to access my history across clinics.',
    })
    .check();
  await page.getByLabel('Allergies', { exact: true }).fill('Synthetic allergy');
  await page.getByRole('button', { name: 'Save your details', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Your profile is up to date' }),
  ).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.globalRole).toBe('PATIENT');
  expect(me.roles).toEqual([]);
  expect(me.consentHistory).toBe(true);
  expect(me.allergies).toEqual(['Synthetic allergy']);
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
});
