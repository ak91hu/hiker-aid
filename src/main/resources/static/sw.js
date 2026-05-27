/* HikerAid Service Worker — offline-first PWA */

const CACHE_NAME = 'hikerAid-v14';
const TILE_CACHE = 'hikerAid-tiles-v1';

const APP_SHELL = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/map.js',
  '/js/elevation.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
];

// Install — cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - Map tiles: cache-first with background revalidation (stale-while-revalidate)
//   - API calls: network-only (no point caching analysis results)
//   - Everything else: cache-first, fall back to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // API calls — network only
  if (url.pathname.startsWith('/api/')) return;

  // Map tiles — stale-while-revalidate
  if (isTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(TILE_CACHE, event.request));
    return;
  }

  // App shell & static assets — network first, fall back to cache when offline
  event.respondWith(networkFirst(CACHE_NAME, event.request));
});

function isTileRequest(url) {
  return url.hostname.includes('tile.openstreetmap.org')
      || url.hostname.includes('tile.opentopomap.org')
      || url.hostname.includes('arcgisonline.com')
      || url.hostname.includes('cartocdn.com')
      || url.hostname.includes('basemaps.cartocdn.com');
}

async function networkFirst(cacheName, request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}
