const CACHE_NAME = 'pbx-v2';
const ASSETS = [
  '/index.html',
  '/manifest.json',
  '/sw.js',
  '/icon-192.png',
  '/icon-512.png'
];

// Install: cache all core assets immediately
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches and claim all clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate strategy
// This ensures the app works offline (from cache) while updating in background
self.addEventListener('fetch', event => {
  // Only handle GET requests from same origin
  if (event.request.method !== 'GET') return;
  
  const url = new URL(event.request.url);
  
  // For navigation requests, always serve from cache first (offline-first)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then(cached => {
        if (cached) return cached;
        return fetch(event.request);
      })
    );
    return;
  }

  // For assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      // Return cached immediately if available
      const fetchPromise = fetch(event.request).then(response => {
        // Update cache with fresh version
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // Network failed, return cached if exists
      
      return cached || fetchPromise;
    })
  );
});
