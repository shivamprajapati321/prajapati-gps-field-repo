/* Expenses PWA Service Worker — ISOLATED, scope /expenses-field.html
   Sirf expense app ki requests handle karta hai. Live field SW se alag.
   Auto-update, network-first. */
var CACHE = 'expenses-v1.0.8-20260623';
var ASSETS = ['/expenses-field.html', '/expenses-field.js', '/manifest-expenses.json'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){
        // sirf apne purane expense caches delete karo, doosre apps ke nahi
        return k.indexOf('expenses-') === 0 && k !== CACHE;
      }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first — SIRF expense app ki files (apne scope ke andar).
// Baaki sab requests (field.html, etc.) ko SW touch nahi karta → divert nahi hota.
self.addEventListener('fetch', function(e){
  var url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.indexOf('/rest/v1') !== -1 || url.indexOf('/storage/v1') !== -1) return; // API: always network

  // SCOPE GUARD: sirf expense app ki apni files handle karo
  var isOwnFile = url.indexOf('/expenses-field') !== -1 ||
                  url.indexOf('/manifest-expenses') !== -1 ||
                  url.indexOf('/icons/expense-') !== -1;
  // CDN libs (jsPDF, tesseract, jsQR) bhi cache karo (offline ke liye)
  var isLib = url.indexOf('cdnjs.cloudflare.com') !== -1 || url.indexOf('jsdelivr') !== -1 ||
              url.indexOf('fonts.googleapis') !== -1 || url.indexOf('fonts.gstatic') !== -1;
  if (!isOwnFile && !isLib) return;  // baaki sab chhod do — divert nahi

  // HTML + JS = NETWORK ONLY (purana code kabhi serve na ho — OTP/feature update turant aaye).
  // Sirf offline pe cache fallback.
  var isCode = url.indexOf('expenses-field.html') !== -1 || url.indexOf('expenses-field.js') !== -1;
  if (isCode){
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).then(function(resp){
        var copy = resp.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy).catch(function(){}); });
        return resp;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(function(resp){
      var copy = resp.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy).catch(function(){}); });
      return resp;
    }).catch(function(){ return caches.match(e.request); })
  );
});
