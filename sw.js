const CACHE_NAME = 'daddy-radio-v3.1.1';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './icon-512.png',
  './manifest.json',
  './music.js'
];

// 앱 본문(index.html / app.css / manifest / music.js)은 항상 최신 우선(network-first).
// 서비스워커 캐시 때문에 업데이트가 안 보이는 문제를 원천 차단.
const NETWORK_FIRST = ['index.html', 'app.css', 'manifest.json', 'music.js'];

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
  // 이 앱의 파일만 다룬다. 방송 스트림·방송사 API·외부 라이브러리는 브라우저가 그대로 처리(저장하지 않음)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 주소가 / 로 끝나면(index.html 생략) 그것도 앱 본문이므로 최신 우선
  const isShell = url.pathname.endsWith('/') || NETWORK_FIRST.some((p) => url.pathname.endsWith(p));

  if (isShell) {
    // 최신 우선: 네트워크 성공 시 캐시 갱신, 실패(오프라인) 시 캐시 사용
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })) // ?v=… 가 붙은 주소도 저장본으로
    );
  } else {
    // 정적 자원(아이콘 등)은 캐시 우선
    e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
  }
});
