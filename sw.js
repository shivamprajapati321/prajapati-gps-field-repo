// Prajapati GPS OCR — Service Worker v8
// Strategy: Cache-first for app shell, network-first for API calls

const CACHE_NAME = 'prajapati-gps-v9';
const APP_SHELL = [
  '/',
  '/field.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-prajapati.png',
  '/logo-prajapati-white.png',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap'
];

// Install — pre-cache app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Some shell items failed to cache:', err);
        // Don't fail install if a few items fail
        return Promise.all(
          APP_SHELL.map((url) => cache.add(url).catch(() => null))
        );
      });
    })
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache POST / non-GET
  if (req.method !== 'GET') return;

  // Never cache Supabase API or storage uploads — always fresh
  if (url.hostname.includes('supabase.co')) return;

  // Never cache Plate Recognizer / LocationIQ — always fresh
  if (url.hostname.includes('platerecognizer.com') || url.hostname.includes('locationiq.com')) return;

  // App shell + same-origin: cache-first with network update
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((networkRes) => {
          // Update cache in background
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // External fonts/CDN: cache-first
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('prajapatiadvertising.com')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // Default: network with cache fallback
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});

// Listen for messages from app (e.g., to skip waiting on update)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
