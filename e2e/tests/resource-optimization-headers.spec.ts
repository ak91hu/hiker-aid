import { test, expect } from '@playwright/test';

test.describe('HikerAid PWA — Resource Optimization & HTTP Headers', () => {

  test('should return 7d Cache-Control and GZIP compression for CSS assets', async ({ request }) => {
    const response = await request.get('/css/style.css', {
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    expect(response.status()).toBe(200);

    const headers = response.headers();

    // Assert Cache-Control header (max-age=604800 or 7d)
    const cacheControl = headers['cache-control'] || '';
    expect(cacheControl).toMatch(/max-age=604800|7d/i);

    // Assert GZIP Content-Encoding header
    const contentEncoding = headers['content-encoding'] || '';
    expect(contentEncoding).toContain('gzip');
  });

  test('should return 7d Cache-Control and GZIP compression for JS assets', async ({ request }) => {
    const response = await request.get('/js/app.js', {
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    expect(response.status()).toBe(200);

    const headers = response.headers();

    // Assert Cache-Control header
    const cacheControl = headers['cache-control'] || '';
    expect(cacheControl).toMatch(/max-age=604800|7d/i);

    // Assert GZIP Content-Encoding header
    const contentEncoding = headers['content-encoding'] || '';
    expect(contentEncoding).toContain('gzip');
  });
});
