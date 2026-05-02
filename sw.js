// Prajapati GPS Field PWA - Silent Auto-Update Service Worker
// Version is auto-bumped on every deploy. NO USER NOTIFICATION EVER.

const VERSION = 'v__BUILD_TIMESTAMP__'; // Auto-replaced on Vercel deploy
const CACHE_NAME = `prajapati-gps-${VERSION}`;

// Files to cache for offline use
const CACHE_FILES = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install: cache fresh files immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_FILES))
      .then(() => self.skipWaiting()) // CRITICAL: take over immediately
  );
});

// Activate: delete old caches, take control
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', VERSION);
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key.startsWith('prajapati-gps-') && key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim()) // CRITICAL: control all open tabs
  );
});

// Fetch strategy: Network-first for HTML (always get latest), cache for everything else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip Supabase API calls (always fresh)
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    return;
  }
  
  // HTML files: Network-first (always check for new version)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Update cache with fresh HTML
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // Offline: use cache
    );
    return;
  }
  
  // Other assets: Cache-first (faster), then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// Listen for skip waiting message (force immediate activation)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
