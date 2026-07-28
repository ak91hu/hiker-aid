import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('HikerAid PWA — Navigation, Panels & Modals', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.goto('/');
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });
  });

  test('should open and close Splits panel with per-km data rows', async ({ page }) => {
    const splitsPanel = page.locator('#splits-panel');
    await expect(splitsPanel).toBeHidden();

    const btnSplits = page.locator('#btn-splits');
    await btnSplits.click({ force: true });
    await expect(splitsPanel).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#splits-tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#splits-summary')).not.toBeEmpty();

    const closeSplits = page.locator('#btn-close-splits');
    await closeSplits.click({ force: true });
    await expect(splitsPanel).toBeHidden();
  });

  test('should open and close Weather panel', async ({ page }) => {
    const weatherPanel = page.locator('#weather-panel');
    await expect(weatherPanel).toBeHidden();

    const btnWeather = page.locator('#btn-weather');
    await btnWeather.click({ force: true });
    await expect(weatherPanel).toBeVisible({ timeout: 10000 });

    const closeWeather = page.locator('#btn-close-weather');
    await closeWeather.click({ force: true });
    await expect(weatherPanel).toBeHidden();
  });

  test('should open Multi-day Stage Planner and dynamically recompute stages', async ({ page }) => {
    const multidayPanel = page.locator('#multiday-panel');
    await expect(multidayPanel).toBeHidden();

    const btnMultiday = page.locator('#btn-multiday');
    await btnMultiday.click({ force: true });
    await expect(multidayPanel).toBeVisible({ timeout: 10000 });

    const hoursInput = page.locator('#multiday-hours');
    await hoursInput.fill('4');
    await hoursInput.dispatchEvent('change');

    // Assert stages table populated
    await expect(page.locator('#multiday-tbody tr')).not.toHaveCount(0);

    const closeMultiday = page.locator('#btn-close-multiday');
    await closeMultiday.click({ force: true });
    await expect(multidayPanel).toBeHidden();
  });

  test('should return to upload screen and reset state when Back button clicked', async ({ page }) => {
    const btnBack = page.locator('#btn-back');
    await btnBack.click({ force: true });
    await expect(page.locator('#upload-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#viewer-screen')).toBeHidden();
  });
});
