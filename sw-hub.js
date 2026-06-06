// ═══════════════════════════════════════════════════════════════════════
// sw-hub.js — Prajapati Operations Hub Service Worker
// 
// Version: hub-v1.0.0
// Scope: /hub.html (whitelist-only, no conflict with /field.html or /app.html SWs)
// ═══════════════════════════════════════════════════════════════════════

const SW_VERSION = 'hub-v1.0.0';
const CACHE_NAME = 'prajapati-hub-' + SW_VERSION;

// Only these URLs are owned by this SW (avoid scope conflicts)
const SCOPE_WHITELIST = [
  '/hub.html',
  '/manifest-hub.json',
  '/icons/hub-icon-192.svg',
  '/icons/hub-icon-512.svg'
];

// Network-first for these (always try fresh)
const NETWORK_FIRST = [
  'supabase.co',
  '/rest/v1/',
  '/functions/v1/'
];

// Cache-first for these (rarely change)
const CACHE_FIRST = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  '.svg',
  '.woff2',
  '.woff',
  '.png',
  '.jpg',
  '.ico'
];

// ─── INSTALL ───
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', SW_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache hub shell
      return cache.addAll([
        '/hub.html',
        '/manifest-hub.json'
      ]).catch(err => {
        console.warn('[SW] Pre-cache failed (non-critical):', err);
      });
    })
  );
  
  self.skipWaiting();
});

// ─── ACTIVATE ───
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', SW_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((keys) => 
        Promise.all(
          keys.filter(k => k.startsWith('prajapati-hub-') && k !== CACHE_NAME)
              .map(k => {
                console.log('[SW] Deleting old cache:', k);
                return caches.delete(k);
              })
        )
      ),
      self.clients.claim()
    ])
  );
});

// ─── FETCH ───
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only handle GET
  if (event.request.method !== 'GET') return;
  
  // Skip if NOT in our scope (don't conflict with field/admin SWs)
  const path = url.pathname;
  const isOurScope = SCOPE_WHITELIST.some(p => path === p || path.startsWith(p));
  const isExternal = url.origin !== self.location.origin;
  
  if (!isOurScope && !isExternal) return;
  
  // Skip non-http(s)
  if (!url.protocol.startsWith('http')) return;
  
  // Network-first for API calls
  if (NETWORK_FIRST.some(p => url.href.includes(p))) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  
  // Cache-first for fonts and static assets
  if (CACHE_FIRST.some(p => url.href.includes(p))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  
  // Stale-while-revalidate for HTML pages (in scope)
  if (isOurScope) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

// ─── STRATEGIES ───

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (err) {
    // If network fails for API, return cached if available
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Otherwise return error JSON
    return new Response(
      JSON.stringify({ error: 'offline', message: 'No network connection' }),
      { 
        status: 503, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      const cache = caches.open(CACHE_NAME);
      cache.then(c => c.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);
  
  return cached || networkPromise || new Response('Offline', { status: 503 });
}

// ─── MESSAGES (from page) ───
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CHECK_VERSION') {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});

console.log('[SW] Hub SW loaded:', SW_VERSION);
