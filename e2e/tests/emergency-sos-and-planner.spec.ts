import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('HikerAid PWA — Emergency SOS, Draw-a-Route Planner & Stage Planner', () => {

  test.beforeEach(async ({ page }) => {
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  });

  test('should render Emergency SOS tab canvas and generate QR code payload', async ({ page }) => {
    await page.goto('/');
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    // Open Survival panel & navigate to SAR / SOS tab
    const survivalBtn = page.locator('#btn-survival');
    await survivalBtn.click({ force: true });
    await expect(page.locator('#survival-panel')).toBeVisible({ timeout: 10000 });

    const sarTab = page.locator('.survival-tab[data-tab="sar"]');
    await sarTab.click({ force: true });
    await expect(page.locator('#stab-sar')).toHaveClass(/active/, { timeout: 10000 });

    // Assert payload generated
    const payloadText = page.locator('#sar-payload-text');
    await expect(payloadText).not.toBeEmpty();
    const payloadVal = await payloadText.inputValue();
    expect(payloadVal).toContain('SOS|HikerAid');

    // Assert Emergency SOS QR canvas rendering (#sos-qr-canvas / #sar-qr-canvas)
    const qrCanvas = page.locator('#sos-qr-canvas, #sar-qr-canvas').first();
    await expect(qrCanvas).toBeVisible({ timeout: 10000 });
    const box = await qrCanvas.boundingBox();
    expect(box?.width).toBeGreaterThan(50);
    expect(box?.height).toBeGreaterThan(50);
  });

  test('should interact with Draw-a-Route planner controls, map points, and elevation profile integration', async ({ page }) => {
    await page.goto('/');

    // Open planner panel (#btn-draw-route / #btn-plan)
    const planBtn = page.locator('#btn-draw-route, #btn-plan').first();
    await planBtn.click({ force: true });

    const plannerPanel = page.locator('#planner-panel');
    await expect(plannerPanel).toBeVisible({ timeout: 10000 });

    // Verify initial state
    await expect(page.locator('#planner-points')).toContainText('0 points');

    // Click on map to add waypoints
    const mapContainer = page.locator('#map');
    await expect(mapContainer).toBeVisible();
    const mapBox = await mapContainer.boundingBox();
    const plannerBox = await plannerPanel.boundingBox();
    expect(mapBox).not.toBeNull();
    expect(plannerBox).not.toBeNull();

    const rightOfPanel = plannerBox!.x + plannerBox!.width - mapBox!.x + 40;
    const belowPanel = plannerBox!.y + plannerBox!.height - mapBox!.y + 40;
    const firstPoint = rightOfPanel < mapBox!.width - 40
      ? { x: rightOfPanel, y: Math.min(100, mapBox!.height - 40) }
      : { x: mapBox!.width / 2, y: Math.min(belowPanel, mapBox!.height - 40) };
    const secondPoint = {
      x: Math.min(firstPoint.x + 40, mapBox!.width - 20),
      y: Math.min(firstPoint.y + 40, mapBox!.height - 20),
    };
    await mapContainer.click({ position: firstPoint });
    await mapContainer.click({ position: secondPoint });

    await expect(page.locator('#planner-points')).not.toContainText('0 points');

    // Test clear draw button (#btn-clear-draw / #btn-plan-clear)
    const clearBtn = page.locator('#btn-clear-draw, #btn-plan-clear').first();
    await clearBtn.click({ force: true });
    await expect(page.locator('#planner-points')).toContainText('0 points');

    // Verify export/analyze draw button (#btn-export-draw / #btn-plan-analyze)
    const exportBtn = page.locator('#btn-export-draw, #btn-plan-analyze').first();
    await expect(exportBtn).toBeVisible({ timeout: 10000 });

    // Verify elevation profile integration panel and canvas elements
    const elevationPanel = page.locator('#elevation-panel');
    await expect(elevationPanel).toBeAttached();
    const elevationChart = page.locator('#elevation-chart');
    await expect(elevationChart).toBeAttached();
  });

  test('should calculate multi-day stage planner breakdown based on hiking hours input', async ({ page }) => {
    await page.goto('/');
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });

    // Open multi-day panel
    const multidayBtn = page.locator('#btn-multiday');
    await multidayBtn.click({ force: true });
    const multidayPanel = page.locator('#multiday-panel');
    await expect(multidayPanel).toBeVisible({ timeout: 10000 });

    // Fill hiking hours (e.g. 4 hours per day)
    const hoursInput = page.locator('#multiday-hours');
    await hoursInput.fill('4');
    await hoursInput.dispatchEvent('change');

    // Assert stage calculation rows populated
    const rows = page.locator('#multiday-tbody tr');
    await expect(rows).not.toHaveCount(0);
    const count4h = await rows.count();

    // Change to 8 hours per day -> stage count should decrease or recalculate
    await hoursInput.fill('8');
    await hoursInput.dispatchEvent('change');
    await expect(rows).not.toHaveCount(0);
    const count8h = await rows.count();

    expect(count8h).toBeLessThanOrEqual(count4h);
  });
});
