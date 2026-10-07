const CACHE = 'work-schedule-v1';
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

  // network-first: תמיד הגרסה העדכנית, ומטמון כשאין אינטרנט
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
