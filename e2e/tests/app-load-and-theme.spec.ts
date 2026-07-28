import { test, expect } from '@playwright/test';

test.describe('HikerAid PWA — Initial Load & Theme / Fitness Controls', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('should display correct title, branding, and hero section', async ({ page }) => {
    await expect(page).toHaveTitle(/HikerAid/i);
    await expect(page.locator('.upload-hero h1')).toHaveText('HikerAid');
    await expect(page.locator('.hero-tagline')).toContainText('Know when to turn back');
    await expect(page.locator('#upload-screen')).toBeVisible();
    await expect(page.locator('#viewer-screen')).toBeHidden();
  });

  test('should toggle light and dark themes correctly when clicking theme button', async ({ page }) => {
    const html = page.locator('html');
    const themeBtn = page.locator('#btn-theme-floating, #btn-theme-viewer').first();
    await expect(themeBtn).toBeVisible({ timeout: 10000 });

    const initialTheme = await html.getAttribute('data-theme');
    await themeBtn.click({ force: true });

    const newTheme = await html.getAttribute('data-theme');
    if (initialTheme === 'light') {
      expect(newTheme === 'dark' || newTheme === null).toBe(true);
    } else {
      expect(newTheme).toBe('light');
    }

    // Toggle back
    await themeBtn.click({ force: true });
    const finalTheme = await html.getAttribute('data-theme');
    expect(finalTheme).toBe(initialTheme);
  });

  test('should allow selecting different fitness levels and updating input', async ({ page }) => {
    const fitnessSelect = page.locator('#fitness-select');
    await expect(fitnessSelect).toBeVisible({ timeout: 10000 });

    await fitnessSelect.selectOption('4'); // Fit
    await expect(fitnessSelect).toHaveValue('4');

    await fitnessSelect.selectOption('5'); // Very fit
    await expect(fitnessSelect).toHaveValue('5');
  });

  test('should allow entering pack weight for physiological load analysis', async ({ page }) => {
    const packInput = page.locator('#pack-input');
    await expect(packInput).toBeVisible({ timeout: 10000 });
    await packInput.fill('15');
    await expect(packInput).toHaveValue('15');
  });
});
