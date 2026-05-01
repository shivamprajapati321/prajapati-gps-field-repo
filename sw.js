// ═══════════════════════════════════════════════════════════════
//  Prajapati GPS Camera - Service Worker
//  Provides offline support and faster loading
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'prajapati-gps-v2.3';
const RUNTIME_CACHE = 'prajapati-runtime-v1';

// Files to cache on install
const CORE_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ─── Install: Cache core files ───
self.addEventListener('install', (event) => {
  console.log('[SW] Installing v' + CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Install error:', err))
  );
});

// ─── Activate: Clean old caches ───
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating v' + CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch: Network-first for API, cache-first for static ───
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // API requests (Supabase) - network only, no caching
  if (url.hostname.includes('supabase.co') || 
      url.hostname.includes('nominatim.openstreetmap.org')) {
    return; // Let browser handle normally
  }
  
  // Same-origin static files - cache-first strategy
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          // Return cached, update in background
          fetch(event.request).then((fresh) => {
            if (fresh && fresh.status === 200) {
              caches.open(CACHE_VERSION).then((cache) => {
                cache.put(event.request, fresh.clone());
              });
            }
          }).catch(() => {});
          return cached;
        }
        
        // Not cached - fetch and cache
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(() => {
          // Offline fallback
          return caches.match('/index.html');
        });
      })
    );
  }
});

// ─── Message: Allow client to skip waiting ───
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service worker loaded');
