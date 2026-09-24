import { test, expect } from '@playwright/test';
import path from 'path';

const fixture = path.resolve(__dirname, '../fixtures/test-route.gpx');

async function expectVisibleControlsAndLabelsNotClipped(page: import('@playwright/test').Page) {
  const clipped = await page.locator(
    'button:visible, h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, label:visible, ' +
    '.stat-card:visible, .feature-card:visible, .s-metric:visible'
  ).evaluateAll(elements => elements.flatMap(element => {
    const node = element as HTMLElement;
    const rect = node.getBoundingClientRect();
    const intersectsViewport = rect.right > 0 && rect.bottom > 0
      && rect.left < window.innerWidth && rect.top < window.innerHeight;
    if (!intersectsViewport) return [];

    const style = getComputedStyle(node);
    const fixedOutsideViewport = style.position === 'fixed'
      && (rect.left < -1 || rect.right > window.innerWidth + 1
        || rect.top < -1 || rect.bottom > window.innerHeight + 1);
    const contentClipped = node.scrollWidth > node.clientWidth + 1
      || node.scrollHeight > node.clientHeight + 1;
    return fixedOutsideViewport || contentClipped
      ? [`${node.id || node.className || node.tagName}: ${node.textContent?.trim().slice(0, 80)}`]
      : [];
  }));

  expect(clipped, `Clipped or partially visible UI elements:\n${clipped.join('\n')}`).toEqual([]);
}

test.describe('HikerAid PWA — accessible operation and recoverable failures', () => {
  test('supports keyboard activation of the GPX upload control', async ({ page }) => {
    await page.goto('/');

    const dropZone = page.getByRole('button', { name: /drop gpx file/i });
    await expect(dropZone).toBeVisible();
    await expect(dropZone).toHaveAttribute('tabindex', '0');

    const chooserPromise = page.waitForEvent('filechooser'); // Playwright's file chooser event
    await dropZone.focus();
    await page.keyboard.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles(fixture);

    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#stat-distance')).toHaveText(/\d/);
  });

  test('shows a useful inline error and keeps inputs available after analysis fails', async ({ page }) => {
    await page.route('**/api/analyze', route => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The GPX route contains no usable track points' }),
    }));
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(fixture);

    const error = page.locator('#upload-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveText('The GPX route contains no usable track points');
    await expect(page.locator('#upload-screen')).toBeVisible();
    await expect(page.locator('#drop-zone')).toBeEnabled();
  });

  test('keeps the selected GPX available after correcting an invalid height', async ({ page }) => {
    await page.goto('/');
    await page.locator('#height-input').fill('100');
    await page.locator('#file-input').setInputFiles(fixture);

    const error = page.getByRole('alert');
    await expect(error).toHaveText('Height must be between 120 and 220 cm');
    await expect(page.locator('#selected-file-name')).toContainText('test-route.gpx');
    await expect(page.getByRole('button', { name: 'Analyze selected GPX' })).toBeVisible();

    await page.locator('#height-input').fill('170');
    await page.getByRole('button', { name: 'Analyze selected GPX' }).click();
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });
  });

  test('explains an unusable route and accepts another file', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles({
      name: 'one-point.gpx',
      mimeType: 'application/gpx+xml',
      buffer: Buffer.from('<gpx version="1.1"><trk><trkseg><trkpt lat="47.5" lon="19.0"/></trkseg></trk></gpx>'),
    });

    await expect(page.getByRole('alert')).toHaveText('The GPX route needs at least two track points');
    await expect(page.locator('#upload-screen')).toBeVisible();

    await page.locator('#file-input').setInputFiles(fixture);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });
  });

  test('accepts the same selected file after a transient analysis failure', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/analyze', route => {
      requests += 1;
      if (requests === 1) return route.abort('failed');
      return route.continue();
    });
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(fixture);

    await expect(page.getByRole('alert')).toContainText('Network error');
    await page.getByRole('button', { name: 'Analyze selected GPX' }).click();
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });
    expect(requests).toBe(2);
  });

  test('exposes specialist route controls with accessible names after analysis', async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles(fixture);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('region', { name: 'Route statistics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Survival toolkit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Multi-day plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle 3D view' })).toBeVisible();
    await expect(page.locator('#map')).toHaveAttribute('aria-label', 'Route map');
  });

  test('keeps controls and labels fully visible in the upload and survival views', async ({ page }) => {
    await page.goto('/');
    await expectVisibleControlsAndLabelsNotClipped(page);

    await page.locator('#file-input').setInputFiles(fixture);
    await expect(page.locator('#viewer-screen')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-survival').click();
    await expect(page.locator('#survival-panel')).toBeVisible();
    await expectVisibleControlsAndLabelsNotClipped(page);

    await page.locator('#stab-btn-resupply').click();
    await expect(page.locator('#stab-resupply')).toBeVisible();
    await expectVisibleControlsAndLabelsNotClipped(page);
  });
});
