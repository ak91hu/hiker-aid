import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('HikerAid PWA — 3D Avalanche Hazard Shading & Map Terrain View', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.maplibregl = window.maplibregl || {
        Map: function (options) {
          const container = typeof options.container === 'string'
            ? document.getElementById(options.container)
            : options.container;
          const canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 400;
          if (container) container.appendChild(canvas);
          return {
            on: (evt, cb) => { if (evt === 'load') setTimeout(cb, 10); },
            addControl: () => {},
            addSource: () => {},
            addLayer: () => {},
            getLayer: () => true,
            setPaintProperty: () => {},
            setLayoutProperty: () => {},
            fitBounds: () => {},
            resize: () => {},
            remove: () => {}
          };
        },
        NavigationControl: function () {}
      };
    });
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.goto('/');
    const filePath = path.resolve(__dirname, '../fixtures/test-route.gpx');
    await page.locator('#file-input').setInputFiles(filePath);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#stat-distance')).not.toHaveText('—', { timeout: 15000 });
  });

  test('should toggle 3D mode, display hazard legend, toggle slope shading, and render 3D canvas', async ({ page }) => {
    // 1. Toggle 3D mode button
    const btn3d = page.locator('#btn-3d');
    await expect(btn3d).toBeVisible({ timeout: 10000 });
    await btn3d.click({ force: true });

    // 3D map container should be visible
    const container3d = page.locator('#map-3d-container');
    await expect(container3d).toBeVisible({ timeout: 15000 });

    // 2. Assert hazard legend overlay (#avy-hazard-legend / #hazard-legend)
    const hazardLegend = page.locator('#avy-hazard-legend, #hazard-legend').first();
    await expect(hazardLegend).toBeVisible({ timeout: 10000 });
    await expect(hazardLegend).toContainText('3D Avalanche Hazard');
    await expect(hazardLegend).toContainText('Low Risk');
    await expect(hazardLegend).toContainText('Avalanche-prone Slope');

    // Assert slope hazard shading degree tiers (<15° green, 15-30° orange, >30° red)
    const legendRows = hazardLegend.locator('.avy-legend-row');
    await expect(legendRows).toHaveCount(3);
    await expect(legendRows.nth(0)).toContainText('< 15° Low Risk');
    await expect(legendRows.nth(1)).toContainText('15°–30° Moderate');
    await expect(legendRows.nth(2)).toContainText('> 30° Avalanche-prone Slope');

    // Assert color swatch values (#2EC4B6 green, #FF9F1C orange, #E71D36 red)
    await expect(legendRows.nth(0).locator('.swatch')).toHaveAttribute('style', /background:\s*#2EC4B6/i);
    await expect(legendRows.nth(1).locator('.swatch')).toHaveAttribute('style', /background:\s*#FF9F1C/i);
    await expect(legendRows.nth(2).locator('.swatch')).toHaveAttribute('style', /background:\s*#E71D36/i);

    // 3. Assert slope shading toggle (#avy-hazard-toggle / #btn-slope-shading)
    const slopeToggle = page.locator('#avy-hazard-toggle, #btn-slope-shading').first();
    await expect(slopeToggle).toBeAttached({ timeout: 10000 });
    await expect(slopeToggle).toBeChecked();

    // Toggle slope shading off and back on
    await slopeToggle.dispatchEvent('click');
    await expect(slopeToggle).not.toBeChecked();
    await slopeToggle.dispatchEvent('click');
    await expect(slopeToggle).toBeChecked();

    // 4. Assert canvas rendering in 3D view (#map-3d canvas / #map3d canvas)
    const canvas3d = page.locator('#map-3d canvas, #map3d canvas, #map-3d-container canvas').first();
    await expect(canvas3d).toBeAttached({ timeout: 15000 });
    const box = await canvas3d.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
  });
});
