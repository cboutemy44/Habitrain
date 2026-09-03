// Service worker Habitrain — cache app-shell pour fonctionnement hors-ligne.
const CACHE = 'habitrain-v8.9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './jsQR.js',
  './qrcode-gen.js',
  './qr.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './foxy-paw.png',
  './foxy-blue.png',
  './foxy-blue2.png',
  './foxy-diaper.png',
  './foxy-changescene.png',
  './guide-steps.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Réseau d'abord pour la navigation (mises à jour), cache en secours.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Cache d'abord pour le reste (polices, icônes, etc.).
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      // met en cache les ressources same-origin récupérées
      if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
