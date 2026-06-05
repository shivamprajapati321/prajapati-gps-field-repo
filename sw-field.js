// ════════════════════════════════════════════════════════════════════
// PRAJAPATI GPS FIELD APP — SERVICE WORKER (ISOLATED)
// 
// CRITICAL: This SW ONLY handles field.html and its assets.
// All other URLs pass through to network without interception.
// ════════════════════════════════════════════════════════════════════

const VERSION = 'field-v15.5.1-speed-20260605';
const CACHE_NAME = 'prajapati-field-' + VERSION;

const FIELD_FILES = [
  '/field.html',
  '/app.js',                           // v15.5.1: precache for fast first-load
  '/manifest-field.json',
  '/icon-field-192.png',
  '/icon-field-512.png',
  '/icon-field-maskable-192.png',
  '/icon-field-maskable-512.png',
  '/icon-field-apple-180.png',
  '/favicon-field-32.png'
];

const ADMIN_FILES = [
  '/app.html', '/admin.html', '/admin-v2.html',
  '/manifest.json', '/sw-admin.js',
  '/icon-192.png', '/icon-512.png'
];

function isFieldFile(p) { return FIELD_FILES.indexOf(p) !== -1; }
function isAdminFile(p) { return ADMIN_FILES.indexOf(p) !== -1; }

self.addEventListener('install', function(event) {
  console.log('[SW-Field] Installing:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(FIELD_FILES).catch(function(err) {
        console.warn('[SW-Field] Asset cache fail:', err);
      });
    })
    // ⭐ v15.4 FIX: REMOVED auto skipWaiting() — was causing reload loop
    // Old behavior: SW auto-activates → controllerchange → page reloads
    // New behavior: SW waits → user sees "Update" banner → clicks → skipWaiting via message
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW-Field] Activating:', VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.indexOf('prajapati-field-') === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function() {
      // ⭐ v15.4 FIX: clients.claim only on EXPLICIT activation
      // (after user clicked Update or first install)
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
  
  // CRITICAL: never intercept admin files
  if (isAdminFile(url.pathname)) return;
  
  // Only handle field files
  if (!isFieldFile(url.pathname)) return;
  
  // Network-first for HTML
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline fallback ONLY to field.html (never admin)
          return caches.match('/field.html');
        })
    );
    return;
  }
  
  // ⭐ v15.4.2 FIX: Network-first for app.js + sw-field.js too
  //    (these change every version — must always fetch fresh when online)
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/sw-field.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(function(response) {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(function() {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Cache-first for OTHER assets (icons, manifest, etc.)
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, copy);
        });
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
