// ════════════════════════════════════════════════════════════════════
// PRAJAPATI ADMIN V2 — SERVICE WORKER
// Strategy: Network-first for HTML/JS, cache-first for static assets
// Version bump triggers cache invalidation
// ════════════════════════════════════════════════════════════════════

const VERSION = 'admin-v2.1-phase4-photofix-20260516';
const CACHE_NAME = 'prajapati-admin-' + VERSION;

// Files to cache on install
const STATIC_ASSETS = [
  '/admin-v2.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install — cache static assets
self.addEventListener('install', function(event) {
  console.log('[SW] Installing version:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(function() {
      // Skip waiting so new SW activates immediately
      return self.skipWaiting();
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating version:', VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.indexOf('prajapati-admin-') === 0 && key !== CACHE_NAME) {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        }
      }));
    }).then(function() {
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Fetch — network-first for HTML/API, cache-first for static
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);
  
  // Skip non-GET
  if (event.request.method !== 'GET') return;
  
  // Skip cross-origin (Supabase API, fonts CDN, etc) — let browser handle
  if (url.origin !== location.origin) return;
  
  // Skip data: URIs
  if (url.protocol === 'data:') return;
  
  // Network-first for HTML
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Update cache with fresh copy
          if (response && response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, responseCopy);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline fallback to cache
          return caches.match(event.request).then(function(cached) {
            return cached || caches.match('/admin-v2.html');
          });
        })
    );
    return;
  }
  
  // Cache-first for static assets (icons, manifest)
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200) return response;
        const responseCopy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseCopy);
        });
        return response;
      }).catch(function() {
        // Static asset offline — return undefined, browser will handle
      });
    })
  );
});

// Message handler — allow page to trigger skip waiting
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
