const CACHE_NAME = 'daddy-radio-v3.0.0-r1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './icon-512.png',
  './manifest.json'
];

// index.html / app.css / manifest 는 항상 최신 우선(network-first).
// 서비스워커 캐시 때문에 업데이트가 안 보이는 문제를 원천 차단.
const NETWORK_FIRST = ['index.html', 'app.css', 'manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(error => {
        console.error('Cache addAll failed:', error);
      });
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      })
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = NETWORK_FIRST.some((p) => url.pathname.endsWith(p));

  if (isShell) {
    // 최신 우선: 네트워크 성공 시 캐시 갱신, 실패(오프라인) 시 캐시 사용
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // 정적 자원(아이콘 등)은 캐시 우선
    e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
  }
});
