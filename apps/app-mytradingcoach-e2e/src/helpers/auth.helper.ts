import { Page } from '@playwright/test';

export const FREE_USER = {
  email: process.env['E2E_FREE_EMAIL'] ?? 'free@test.com',
  password: process.env['E2E_FREE_PASSWORD'] ?? 'Password123!',
};

export const PREMIUM_USER = {
  email: process.env['E2E_PREMIUM_EMAIL'] ?? 'premium@test.com',
  password: process.env['E2E_PREMIUM_PASSWORD'] ?? 'Password123!',
};

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|analytics|journal)/, { timeout: 15000 });
}
