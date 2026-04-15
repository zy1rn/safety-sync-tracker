const CACHE_NAME = 'safety-sync-v2';

const assets = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/siren.mp3',
  '/manifest.json',
  '/icon-192.png', 
  '/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// Install Event
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching shell assets');
      cache.addAll(assets);
    })
  );
});

// Activate Event
self.addEventListener('activate', evt => {
  console.log('Service Worker activated');
});

// Fetch Event
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      return cacheRes || fetch(evt.request);
    })
  );
});