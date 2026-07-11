/* 하루두잉 서비스 워커: 오프라인 캐시 + (Windows 11 Edge) 위젯 */
const CACHE = 'hd-shell-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'icons.js', 'icons-data.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'widgets/today-card.json', 'widgets/today-data.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hd-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 위젯 데이터: 앱이 캐시에 써둔 최신 데이터 우선
  if (url.pathname.endsWith('widgets/today-data.json')) {
    e.respondWith((async () => {
      const c = await caches.open('hd-widget');
      return (await c.match('widgets/today-data.json')) || fetch(e.request).catch(() => new Response('{}'));
    })());
    return;
  }
  // 구글 폰트: 캐시 우선 (오프라인 손글씨체)
  if (url.hostname.includes('fonts.g')) {
    e.respondWith((async () => {
      const c = await caches.open('hd-fonts');
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      } catch (err) { return new Response('', { status: 408 }); }
    })());
    return;
  }
  // 앱 셸: 네트워크 우선, 실패 시 캐시 (개인용이라 항상 최신 우선)
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok && e.request.method === 'GET') {
          const c = await caches.open(CACHE);
          c.put(e.request, res.clone());
        }
        return res;
      } catch (err) {
        const c = await caches.open(CACHE);
        return (await c.match(e.request)) || (await c.match('index.html'));
      }
    })());
  }
});

/* ---------- Windows 11 위젯 보드 (Edge 전용 API, 있을 때만 동작) ---------- */
async function renderWidgets() {
  if (!self.widgets) return;
  try {
    const c = await caches.open('hd-widget');
    const hit = await c.match('widgets/today-data.json');
    const data = hit ? await hit.json() : { date: '', mood: '', remaining: 0, items: [] };
    const widget = await self.widgets.getByTag('haru-today');
    if (!widget) return;
    const tplRes = await fetch(widget.definition.msAcTemplate);
    const template = await tplRes.text();
    await self.widgets.updateByTag('haru-today', { template, data: JSON.stringify(data) });
  } catch (e) {}
}
self.addEventListener('widgetinstall', e => e.waitUntil(renderWidgets()));
self.addEventListener('widgetresume', e => e.waitUntil(renderWidgets()));
self.addEventListener('widgetclick', e => e.waitUntil(renderWidgets()));
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'widget-update') renderWidgets();
});
