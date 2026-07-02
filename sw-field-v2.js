// ════════════════════════════════════════════════════════════════════
// PRAJAPATI GPS FIELD APP V2 — SERVICE WORKER (ISOLATED, AUTO-UPDATE)
//
// CRITICAL: This SW ONLY handles field-v2.html and app-v2.js.
// Alag scope (/field-v2.html) — live field.html ke SW se koi conflict NAHI.
// AUTO-UPDATE: naya version deploy hote hi app khud update (no reinstall).
// ════════════════════════════════════════════════════════════════════

const VERSION = 'mars-gps-2.2.3-20260702';
const CACHE_NAME = 'mars-gps-' + VERSION;

const FIELD_FILES = [
  '/field-v2.html',
  '/app-v2.js',
  '/manifest-field-v2.json',
  '/icons/mars-gps-192.png',
  '/icons/mars-gps-512.png',
  '/icons/mars-gps-maskable-192.png',
  '/icons/mars-gps-maskable-512.png',
  '/icons/mars-gps-apple-180.png',
  '/icons/mars-gps-favicon-32.png'
];

const ADMIN_FILES = [
  '/app.html', '/admin.html', '/admin-v2.html',
  '/manifest.json', '/sw-admin.js',
  '/icon-192.png', '/icon-512.png'
];

// live field app (v1) ke files — v2 SW inhe NEVER intercept kare
const V1_FIELD_FILES = ['/field.html', '/app.js', '/sw-field.js'];

function isFieldFile(p) { return FIELD_FILES.indexOf(p) !== -1; }
function isAdminFile(p) { return ADMIN_FILES.indexOf(p) !== -1; }
function isV1Field(p) { return V1_FIELD_FILES.indexOf(p) !== -1; }

self.addEventListener('install', function(event) {
  console.log('[SW-Field-v2] Installing:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(FIELD_FILES).catch(function(err) {
        console.warn('[SW-Field-v2] Asset cache fail:', err);
      });
    }).then(function(){
      // ⭐ AUTO-UPDATE: naya SW turant activate (user ko reinstall nahi karna padega)
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW-Field-v2] Activating:', VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        // sirf apne purane v2 caches delete karo
        if (key.indexOf('mars-gps-') === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(c) {
          c.postMessage({ type: 'SW_UPDATED', version: VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.protocol === 'data:' || url.protocol === 'blob:') return;

  // NEVER intercept admin files ya live v1 field files
  if (isAdminFile(url.pathname)) return;
  if (isV1Field(url.pathname)) return;

  // Only handle v2 field files
  if (!isFieldFile(url.pathname)) return;

  // Network-first for HTML (always fresh when online)
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function() { return caches.match('/field-v2.html'); })
    );
    return;
  }

  // Network-first for app-v2.js (changes every version)
  if (url.pathname.endsWith('/app-v2.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
          }
          return response;
        })
        .catch(function() { return caches.match(event.request); })
    );
    return;
  }

  // Cache-first for other assets (icons, manifest)
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, copy); });
        return response;
      }).catch(function() { return undefined; });
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
