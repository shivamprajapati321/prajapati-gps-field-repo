// Service Worker for HR PWA
// Whitelist-only caching - doesn't touch admin or field files

const CACHE_NAME = 'hr-v1.0.0';
const HR_FILES = [
  '/hr.html',
  '/lib/wati-client.js',
  '/lib/access-guard.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(HR_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Only handle HR files
  if (!HR_FILES.some(f => url.pathname === f)) return;
  
  e.respondWith(
    caches.match(e.request).then(cached => 
      cached || fetch(e.request)
    )
  );
});
