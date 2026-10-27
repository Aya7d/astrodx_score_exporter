const CACHE_NAME = 'astrodx-exporter-v7';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './favicon.ico',
  './src/css/style.css',
  './src/js/main.js',
  './src/js/vendor/crypto-js.js',
  './src/js/modules/codec.js',
  './src/js/modules/extractor.js',
  './src/js/modules/converters.js',
  './src/data/maimai_db.json',
  './src/js/modules/exporters.js',
  './src/js/modules/cloud_share.js',
  './src/js/modules/migrator.js',
  './src/js/modules/demo_data.js',
  './src/js/modules/grade.js',
  './src/js/modules/ui.js',
  './manifest.json',
  './assets/icon.png',
  './assets/fonts/Torus-SemiBold.otf',
  './assets/fonts/Torus-Regular.otf',
  'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Some assets could not be pre-cached immediately:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Do not intercept non-GET requests or sharing API requests (dpaste / bytebin)
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin.includes('dpaste.com') || url.origin.includes('bytebin.lucko.me')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cache but update in background (stale-while-revalidate for local assets)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
