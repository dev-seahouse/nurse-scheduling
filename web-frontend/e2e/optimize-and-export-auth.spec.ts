/*
 * This file is part of Nurse Scheduling Project, see <https://github.com/j3soon/nurse-scheduling>.
 *
 * Copyright (C) 2023-2026 Johnson Sun
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { expect, test } from './test';
import { E2E_BACKEND_API_URL } from './constants';
import { disableModalDialogs, mockOptimizeAndExport, seedSchedulingState } from './helpers';

const BACKEND_URL = E2E_BACKEND_API_URL;
const BACKEND_TOKEN = 'e2e-shared-backend-token';
const STORAGE_KEY = 'nurse-scheduling-backend-token';

const seedMinimalSchedule = (page: Parameters<typeof seedSchedulingState>[0]) => seedSchedulingState(page, {
  apiVersion: 'test',
  description: 'optimize auth seed',
  dates: {
    range: { startDate: '2026-05-01', endDate: '2026-05-01' },
    groups: [],
  },
  people: {
    items: [{ id: 'P1', description: 'Primary nurse', history: [] }],
    groups: [],
    history: [],
  },
  shiftTypes: {
    items: [{ id: 'D', description: 'Day' }],
    groups: [],
  },
  preferences: [{ type: 'at most one shift per day' }],
  export: { formatting: [] },
});

test('optimize and export authenticates a protected backend with a remembered token', async ({ page }) => {
  /*
   * Steps:
   * 1. Seed a minimal valid schedule and a backend that requires a shared token.
   * 2. Confirm the page reports that credentials are required and blocks optimizing.
   * 3. Enter the token and keep it on this device.
   * 4. Confirm the backend comes online, the run succeeds, and the token is stored.
   */
  await disableModalDialogs(page);
  await seedMinimalSchedule(page);
  await mockOptimizeAndExport(page, { requiredAuthToken: BACKEND_TOKEN });

  await page.goto('/optimize-and-export');
  await expect(page.getByText('Server: Credentials required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Optimize and Download' })).toBeDisabled();

  await page.getByRole('button', { name: `Enter token for ${BACKEND_URL}` }).click();
  await page.getByLabel(`Token for ${BACKEND_URL}`, { exact: true }).fill(BACKEND_TOKEN);
  await page.getByRole('checkbox', { name: /remember on this device/i }).check();
  await page.getByRole('button', { name: `Save token for ${BACKEND_URL}` }).click();

  await expect(page.getByText('Server: Online')).toBeVisible();
  await expect(page.getByText('Token saved on this device')).toBeVisible();

  await page.getByRole('button', { name: 'Optimize and Download' }).click();
  await expect(page.getByText('Schedule optimized and downloaded successfully!')).toBeVisible();

  const storedToken = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    STORAGE_KEY
  );
  expect(storedToken).toEqual({ endpoint: BACKEND_URL, token: BACKEND_TOKEN });
});

test('optimize and export distinguishes a rejected token from a missing one', async ({ page }) => {
  /*
   * Steps:
   * 1. Seed a stored token that the backend refuses.
   * 2. Confirm the Status icon reports a rejection through its hover text.
   * 3. Clear the token and confirm the icon falls back to the missing-token state.
   */
  await disableModalDialogs(page);
  await seedMinimalSchedule(page);
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: JSON.stringify({ endpoint: BACKEND_URL, token: 'stale-token' }),
  });
  await mockOptimizeAndExport(page, { requiredAuthToken: BACKEND_TOKEN });

  await page.goto('/optimize-and-export');

  const status = page.getByLabel(`${BACKEND_URL} status: Credentials rejected`);
  await expect(status).toHaveAttribute(
    'title',
    'Credentials rejected. Select Change to enter the current token.'
  );
  await expect(page.getByText(/Last checked:.*rejected/i)).toHaveCount(0);

  // Correcting a rejected token starts from the stored value rather than a blank field.
  await page.getByRole('button', { name: `Change token for ${BACKEND_URL}` }).click();
  await expect(page.getByLabel(`Token for ${BACKEND_URL}`, { exact: true })).toHaveValue('stale-token');
  await page.getByRole('button', { name: `Cancel token for ${BACKEND_URL}` }).click();

  await page.getByRole('button', { name: `Forget token for ${BACKEND_URL}` }).click();
  await expect(page.getByLabel(`${BACKEND_URL} status: Credentials required`)).toHaveAttribute(
    'title',
    'Credentials required. Select Enter token to continue.'
  );
});

test('optimize and export keeps a one-time token out of browser storage', async ({ page }) => {
  /*
   * Steps:
   * 1. Seed a minimal valid schedule and a backend that requires a shared token.
   * 2. Enter the token without keeping it on this device.
   * 3. Confirm the run succeeds while storage keeps no token.
   */
  await disableModalDialogs(page);
  await seedMinimalSchedule(page);
  await mockOptimizeAndExport(page, { requiredAuthToken: BACKEND_TOKEN });

  await page.goto('/optimize-and-export');
  await page.getByRole('button', { name: `Enter token for ${BACKEND_URL}` }).click();
  await page.getByLabel(`Token for ${BACKEND_URL}`, { exact: true }).fill(BACKEND_TOKEN);
  await page.getByRole('button', { name: `Save token for ${BACKEND_URL}` }).click();

  await expect(page.getByText('Token set for this session')).toBeVisible();
  await page.getByRole('button', { name: 'Optimize and Download' }).click();
  await expect(page.getByText('Schedule optimized and downloaded successfully!')).toBeVisible();

  const storedToken = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    STORAGE_KEY
  );
  expect(storedToken).toBeNull();
});

test('optimize and export stays unchanged against a backend without authentication', async ({ page }) => {
  /*
   * Steps:
   * 1. Seed a minimal valid schedule and an open backend.
   * 2. Confirm no credential controls appear and the run succeeds directly.
   */
  await disableModalDialogs(page);
  await seedMinimalSchedule(page);
  await mockOptimizeAndExport(page);

  await page.goto('/optimize-and-export');
  await expect(page.getByText('Server: Online')).toBeVisible();
  await expect(page.getByRole('button', { name: `Enter token for ${BACKEND_URL}` })).toHaveCount(0);

  await page.getByRole('button', { name: 'Optimize and Download' }).click();
  await expect(page.getByText('Schedule optimized and downloaded successfully!')).toBeVisible();
});
