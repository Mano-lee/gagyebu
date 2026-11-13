// 페이지와 냉장고 화면의 파일을 함께 저장해 오프라인에서도 사용할 수 있게 한다.
const CACHE = 'gagyebu-platform-v3';
const ASSETS = ['./', './fridge.js', './fridge.css', './platform.js', './platform.css', './manifest.webmanifest', './app-icon.svg', './app-icon-192.png', './app-icon-512.png', './apple-touch-icon.png', './favicon-32.png'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key === 'gagyebu' || ((key.startsWith('gagyebu-fridge-') || key.startsWith('gagyebu-platform-')) && key !== CACHE)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // 구글 시트 요청과 다른 앱의 요청은 건드리지 않는다.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope)) return;
  const navigation = event.request.mode === 'navigate';
  if (!navigation && !assetURLs.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request) || (navigation && await cache.match(new URL('./', self.registration.scope).href));
      if (cached) return cached;
      throw error;
    }
  })());
});
