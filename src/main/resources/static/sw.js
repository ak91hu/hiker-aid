const CACHE_NAME = 'hikerAid-v20';
const TILE_CACHE = 'hikerAid-tiles-v2';

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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

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

self.addEventListener('sync', event => {
  if (event.tag === 'sync-activities') {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_ACTIVITIES' });
  }
}

function reply(event, data) {
  if (event.ports && event.ports[0]) event.ports[0].postMessage(data);
  else event.source?.postMessage(data);
}

self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_TILE_CACHE') {
    caches.delete(TILE_CACHE).then(() => reply(event, { type: 'TILE_CACHE_CLEARED' }));
  } else if (event.data?.type === 'TILE_CACHE_SIZE') {
    estimateTileCacheBytes().then(bytes => reply(event, { type: 'TILE_CACHE_SIZE_RESULT', bytes }));
  }
});

async function estimateTileCacheBytes() {
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    return keys.length * 20 * 1024;
  } catch { return 0; }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  if (isTileRequest(url)) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  event.respondWith(networkFirst(CACHE_NAME, event.request));
});

function isTileRequest(url) {
  return url.hostname.includes('tile.openstreetmap.org')
      || url.hostname.includes('tile.opentopomap.org')
      || url.hostname.includes('arcgisonline.com')
      || url.hostname.includes('cartocdn.com')
      || url.hostname.includes('basemaps.cartocdn.com');
}

function normalizeTileKey(url) {
  return url.replace(/^(https?:\/\/)[abc]\./, '$1z.');
}

async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cacheKey = normalizeTileKey(request.url);
  const cached = await cache.match(cacheKey);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
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
