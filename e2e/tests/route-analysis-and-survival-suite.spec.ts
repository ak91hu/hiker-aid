import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('HikerAid PWA — route analysis and survival toolkit', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.goto('/');
  });

  test('should upload GPX, analyze route, and verify statistical metrics strip', async ({ page }) => {
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');

    // Set pack weight to test mechanical load calculations
    const packInput = page.locator('#pack-input');
    await packInput.fill('12');

    // Upload GPX file and trigger analysis
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(filePath);

    // Screen transition assertion
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#upload-screen')).toBeHidden();

    // Verify stats strip cards populated with real numbers
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });
    await expect(page.locator('#stat-ascent')).not.toHaveText('—');
    await expect(page.locator('#stat-difficulty')).not.toHaveText('—');
    await expect(page.locator('#stat-ams')).not.toHaveText('—');
    await expect(page.locator('#stat-water')).toContainText('L');
  });

  test('opens the survival toolkit and tests the AMS risk analyzer tab', async ({ page }) => {
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    // Open the survival toolkit via the AMS stat card or top button.
    const cardAms = page.locator('#card-ams');
    await cardAms.click({ force: true });
    const modal = page.locator('#survival-panel');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Verify AMS tab active by default when opening via AMS card
    await expect(page.locator('#stab-ams')).toHaveClass(/active/);
    await expect(page.locator('#ams-max-alt')).toContainText('2650 m');
    await expect(page.locator('#ams-spo2')).not.toHaveText('—');
    await expect(page.locator('#ams-risk-badge')).toContainText(/MODERATE|LOW|HIGH/i);
    await expect(page.locator('#ams-advice')).not.toBeEmpty();
  });

  test('should test Dynamic Hydration & Nutrition Resupply calculator with slider interactivity', async ({ page }) => {
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    const packInput = page.locator('#pack-input');
    await packInput.fill('15');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    const btnSurvival = page.locator('#btn-survival');
    await btnSurvival.click({ force: true });
    await expect(page.locator('#survival-panel')).toBeVisible({ timeout: 10000 });
    const tabResupply = page.locator('.survival-tab[data-tab="resupply"]');
    await tabResupply.click({ force: true });
    await expect(page.locator('#stab-resupply')).toHaveClass(/active/, { timeout: 10000 });

    const initialWater = await page.locator('#res-water-total').innerText();
    expect(initialWater).toContain('L');

    // Interact with cold exposure temperature slider (sub-zero -5°C)
    const tempSlider = page.locator('#resupply-temp');
    await tempSlider.fill('-5');
    await tempSlider.dispatchEvent('input');
    await expect(page.locator('#resupply-temp-val')).toHaveText('-5°C');

    // Interact with heat stress temperature slider (increase to 35°C)
    await tempSlider.fill('35');
    await tempSlider.dispatchEvent('input');
    await expect(page.locator('#resupply-temp-val')).toHaveText('35°C');

    // Water demand must increase due to heat stress
    const updatedWater = await page.locator('#res-water-total').innerText();
    const initVal = parseFloat(initialWater);
    const updVal = parseFloat(updatedWater);
    expect(updVal).toBeGreaterThan(initVal);

    // Verify electrolytes and calories calculated
    await expect(page.locator('#res-kcal')).toContainText('kcal');
    await expect(page.locator('#res-electrolytes')).toContainText('mg Na⁺');
  });

  test('should test Technical Terrain & Avalanche Hazard Matrix classification', async ({ page }) => {
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    const btnSurvival = page.locator('#btn-survival');
    await btnSurvival.click({ force: true });
    await expect(page.locator('#survival-panel')).toBeVisible({ timeout: 10000 });
    const tabTerrain = page.locator('.survival-tab[data-tab="terrain"]');
    await tabTerrain.click({ force: true });
    await expect(page.locator('#stab-terrain')).toHaveClass(/active/, { timeout: 10000 });

    await expect(page.locator('#ter-max-slope')).not.toHaveText('—');
    await expect(page.locator('#ter-grade')).not.toHaveText('—');

    // Assert terrain segment distribution bar rendered with child elements
    const barSegments = page.locator('#terrain-dist-bar span');
    await expect(barSegments.first()).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#terrain-bar-legend')).toContainText('km');
  });

  test('should verify Offline SAR Emergency Beacon payload and high-contrast canvas', async ({ page }) => {
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    const btnSurvival = page.locator('#btn-survival');
    await btnSurvival.click({ force: true });
    await expect(page.locator('#survival-panel')).toBeVisible({ timeout: 10000 });
    const tabSar = page.locator('.survival-tab[data-tab="sar"]');
    await tabSar.click({ force: true });
    await expect(page.locator('#stab-sar')).toHaveClass(/active/, { timeout: 10000 });

    // Verify SOS payload text box
    const payloadInput = page.locator('#sar-payload-text');
    await expect(payloadInput).not.toBeEmpty();
    const val = await payloadInput.inputValue();
    expect(val).toContain('SOS|HikerAid|ROUTE:');
    expect(val).toContain('MAXALT:2650m');

    // Verify visual emergency beacon canvas exists and has dimensions
    const canvas = page.locator('#sar-qr-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(100);
    expect(box?.height).toBeGreaterThan(100);
  });
});
