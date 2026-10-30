// 앱 설치용 서비스 워커: 페이지는 항상 최신 버전을 먼저 받고,
// 인터넷이 안 될 때만 마지막으로 받은 페이지를 보여줌.
// 구글 시트와 주고받는 요청은 건드리지 않음.
const CACHE = 'gagyebu';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./', copy)); return r; })
      .catch(() => caches.match('./'))
  );
});
