// Prajapati GPS Field App - Service Worker v15
// AGGRESSIVE AUTO-UPDATE: skipWaiting + clients.claim + network-first HTML/JS

const VERSION = 'v15.3-2026-05-15';
const STATIC_CACHE = 'prajapati-static-' + VERSION;

const STATIC_ASSETS = [
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', function(event) {
  console.log('[SW v15.2] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(e) {
        console.warn('[SW] Some assets failed to cache:', e);
      });
    }).then(function() {
      console.log('[SW v15.2] Skip waiting - activate NOW');
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW v15.2] Activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then(function(names) {
        return Promise.all(
          names.filter(function(name) { return name !== STATIC_CACHE; })
               .map(function(name) {
                 console.log('[SW] Deleting old cache:', name);
                 return caches.delete(name);
               })
        );
      }),
      self.clients.claim()
    ]).then(function() {
      console.log('[SW v15.2] Activated, claimed all clients');
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_ACTIVATED', version: VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);
  
  if (event.request.method !== 'GET') return;
  
  // Skip API calls - never intercept
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('platerecognizer.com') ||
      url.hostname.includes('locationiq.com') ||
      url.hostname.includes('nominatim.org') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }
  
  // HTML and JS: NETWORK-FIRST (always check for updates)
  if (url.pathname.endsWith('.html') || 
      url.pathname.endsWith('.js') ||
      url.pathname === '/' ||
      url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(function() { return caches.match(event.request); })
    );
    return;
  }
  
  // Icons, manifest: CACHE-FIRST
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|woff2|woff|json)$/)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then(function(c) { c.put(event.request, clone); });
          }
          return response;
        });
      })
    );
    return;
  }
});

// Listen for SKIP_WAITING from app (force update)
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
