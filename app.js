// ═══════════════════════════════════════════════════════════════════════════
// Prajapati GPS Field App — Service Worker
// AUTO-UPDATE STRATEGY: Network-first, skip waiting, instant activation
// 
// VERSION: v10 (bump this on every deploy)
// ═══════════════════════════════════════════════════════════════════════════

const VERSION = 'v11';                        // ⭐ BUMP ON EVERY DEPLOY
const CACHE_NAME = 'prajapati-gps-' + VERSION;

// Files to pre-cache for offline support
const PRECACHE_URLS = [
  '/',
  '/field.html',
  '/manifest.json'
];

// ─── INSTALL: Pre-cache critical assets ───
self.addEventListener('install', function(event) {
  console.log('[SW] Installing', VERSION);
  
  // CRITICAL: skipWaiting() immediately so new SW takes control ASAP
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Use addAll but ignore individual failures (404s shouldn't block install)
      return Promise.allSettled(
        PRECACHE_URLS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Pre-cache failed for', url, err.message);
          });
        })
      );
    })
  );
});

// ─── ACTIVATE: Clean old caches + claim clients ───
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating', VERSION);
  
  event.waitUntil(
    Promise.all([
      // Delete ALL old caches (not just prajapati-gps-* — clean slate)
      caches.keys().then(function(names) {
        return Promise.all(
          names.map(function(name) {
            if (name !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }
          })
        );
      }),
      // CRITICAL: Claim all clients immediately (existing tabs use new SW)
      self.clients.claim()
    ]).then(function() {
      // Notify all clients that new SW is active
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_ACTIVATED', version: VERSION });
        });
      });
    })
  );
});

// ─── FETCH: Network-first for HTML/JS, cache fallback ───
// CRITICAL: NEVER cache field.html for long — always try network first
// This ensures auto-update can detect new version
self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);
  
  // Only handle same-origin GET requests
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  
  // ═══ STRATEGY 1: HTML & JS files → NETWORK FIRST (no cache poisoning) ═══
  if (req.destination === 'document' || 
      url.pathname.endsWith('.html') || 
      url.pathname.endsWith('.js') ||
      url.pathname === '/') {
    
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(function(response) {
          // Update cache with fresh response (for offline fallback)
          if (response.ok) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, respClone);
            });
          }
          return response;
        })
        .catch(function() {
          // Network failed → fall back to cache
          return caches.match(req).then(function(cached) {
            if (cached) {
              console.log('[SW] Offline fallback for:', url.pathname);
              return cached;
            }
            // Last resort: return basic offline page
            return new Response('Offline — no cached version', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }
  
  // ═══ STRATEGY 2: Static assets (images, fonts, CSS) → CACHE FIRST ═══
  if (req.destination === 'image' || 
      req.destination === 'font' || 
      req.destination === 'style') {
    
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(response) {
          if (response.ok) {
            const respClone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, respClone);
            });
          }
          return response;
        }).catch(function() {
          return new Response('', { status: 504 });
        });
      })
    );
    return;
  }
  
  // ═══ STRATEGY 3: API calls (Supabase, etc.) → NETWORK ONLY ═══
  // Don't cache API responses — always fresh data
  // Default browser behavior (no event.respondWith) = network only
});

// ─── MESSAGE: Handle SKIP_WAITING from client ───
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_VERSION') {
    event.ports[0] && event.ports[0].postMessage({ version: VERSION });
  }
});

console.log('[SW] Loaded:', VERSION);
