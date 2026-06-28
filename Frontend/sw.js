const CACHE_NAME = 'oc-quan4-cache-v14';
const ASSETS_TO_CACHE = [
  './index.html',
  './style.css?v=4',
  './app.js?v=18',
  './db.js',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch Event
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Exclude API calls from service worker caching (keep MP3 caching enabled)
  if (url.pathname.includes('/api/')) {
    return;
  }

  const isAppShellRequest = [
    '/index.html',
    '/app.js',
    '/style.css',
    '/db.js',
    '/manifest.json'
  ].some(path => url.pathname === path || url.pathname.endsWith(path));

  if (isAppShellRequest) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        return networkResponse;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        if (
          event.request.method === 'GET' &&
          (url.hostname.includes('tile.openstreetmap.org') ||
            url.pathname.includes('/tile/') ||
            url.pathname.includes('/images/') ||
            url.pathname.includes('/audio/') ||
            url.pathname.endsWith('.mp3'))
        ) {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      }).catch(err => {
        console.warn('Network request failed, resource not cached offline:', url.href);
        return new Response('Network error occurred', { status: 408 });
      });
    })
  );
});
