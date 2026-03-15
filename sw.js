const CACHE_NAME = 'daddy-radio-v4';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './icon-512.png',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 즉시 활성화 유도
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
