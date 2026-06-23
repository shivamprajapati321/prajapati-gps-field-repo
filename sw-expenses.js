/* Expenses PWA Service Worker — auto-update, network-first */
var CACHE = 'expenses-v1.0.1-20260622';
var ASSETS = ['/expenses-field.html', '/expenses-field.js', '/manifest-expenses.json'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first for HTML/JS (always fresh), cache fallback offline
self.addEventListener('fetch', function(e){
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.indexOf('/rest/v1') !== -1 || url.indexOf('/storage/v1') !== -1) return; // API: always network
  e.respondWith(
    fetch(e.request).then(function(resp){
      var copy = resp.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy).catch(function(){}); });
      return resp;
    }).catch(function(){ return caches.match(e.request); })
  );
});
