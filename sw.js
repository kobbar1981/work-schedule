const CACHE = 'work-schedule-v3';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // רק קבצים מהאתר עצמו ומ-cdnjs; Firebase/Firestore עוברים ישר לרשת
  if (url.origin !== location.origin && url.hostname !== 'cdnjs.cloudflare.com') return;
  if (url.pathname.endsWith('firebase-messaging-sw.js')) return;

  // stale-while-revalidate: מגישים מיד מהמטמון (פתיחה מהירה), ומרעננים אותו ברקע.
  // הגרסה החדשה נטענת בפתיחה הבאה, והאפליקציה גם מציגה באנר "יש גרסה חדשה" (checkForNewVersion).
  // דפים (navigate) נשמרים תמיד תחת index.html, כדי ש-?r=... לא ייצור עותק נפרד לכל עסק.
  const isNav = req.mode === 'navigate';
  const key = isNav ? './index.html' : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);

    const refresh = fetch(req).then(res => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    });

    if (cached) {
      e.waitUntil(refresh.catch(() => {}));   // רענון ברקע; כישלון (אין רשת) לא משנה כלום
      return cached;
    }
    // אין במטמון: מחכים לרשת
    try { return await refresh; }
    catch (err) { return (isNav && await cache.match('./index.html')) || Response.error(); }
  })());
});
