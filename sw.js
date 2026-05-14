// Prajapati GPS - Service Worker v12
// NUCLEAR auto-update: HTML/JS always network-first

const VERSION = 'v12';
const CACHE_NAME = 'prajapati-gps-' + VERSION;
const PRECACHE_URLS = ['/manifest.json'];

self.addEventListener('install', function(event) {
  console.log('[SW v12] Installing...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        PRECACHE_URLS.map(function(url) { return cache.add(url).catch(function() {}); })
      );
    })
  );
});

self.addEventListener('activate', function(event) {
  console.log('[SW v12] Activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(name) {
          if (name !== CACHE_NAME) {
            console.log('[SW v12] Deleting old cache:', name);
            return caches.delete(name);
          }
        }));
      }),
      self.clients.claim()
    ]).then(function() {
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_ACTIVATED', version: VERSION });
        });
      });
    })
  );
});

self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  
  const isAppCode = req.destination === 'document' || 
                    url.pathname.endsWith('.html') || 
                    url.pathname.endsWith('.js') ||
                    url.pathname.endsWith('.css') ||
                    url.pathname.endsWith('.json') ||
                    url.pathname === '/';
  
  if (isAppCode) {
    event.respondWith(
      fetch(req, { 
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      })
        .then(function(response) { return response; })
        .catch(function() {
          return caches.match(req).then(function(cached) {
            if (cached) return cached;
            return new Response('Offline - reconnect to internet', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }
  
  if (req.destination === 'image' || req.destination === 'font') {
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
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Loaded v12');
