// Service worker Habitrain — cache app-shell pour fonctionnement hors-ligne.
const CACHE = 'habitrain-v23.9';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './nfc.js',
  './qr.js',
  './sensor.js',
  './lock.js',
  './wardrobe.js',
  './missions.js',
  './badges.js',
  './tips.js',
  './native.js',
  './tenue-sensor.js',
  './badges-foxy.png',
  './badges-couche.png',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './foxy-paw.png',
  './foxy-diaper-v3.png',
  './foxy-blue2-v3.png',
  './foxy-blue-v3.png',
  './foxy-paw-v3.png',
  './foxy-diaper-v1.png',
  './foxy-blue2-v1.png',
  './foxy-blue-v1.png',
  './foxy-paw-v1.png',
  './foxy-blue.png',
  './foxy-blue2.png',
  './foxy-diaper.png',
  './foxy-changescene.png',
  './guide-steps.png'
];

/* Mise en cache fichier par fichier, et non en bloc.
   addAll() est atomique : un seul fichier manquant faisait échouer TOUTE
   l'installation, le nouveau service worker n'était jamais activé, et
   l'ancienne version continuait d'être servie sans fin ni message d'erreur.
   Ici chaque fichier est indépendant : ce qui manque est simplement absent
   du cache hors-ligne, et la mise à jour aboutit quand même. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(ASSETS.map((url) =>
        c.add(url).catch((e) => {
          console.warn('[Habitrain] non mis en cache :', url, e && e.message);
        })
      ))
    ).then(() => self.skipWaiting())
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
  /* Le CODE passe par le réseau d'abord, le cache seulement en secours.
     En cache d'abord, on pouvait se retrouver avec l'index.html NEUF (servi
     par le réseau) et un app.js VIEUX (servi par le cache) : la page appelait
     des éléments que l'ancien script ne connaissait pas, le script s'arrêtait
     en cours de route, et des pans entiers de l'appli restaient morts —
     typiquement les derniers menus câblés. HTML, JS et CSS doivent toujours
     venir de la même version. */
  const memeOrigine = req.url.startsWith(self.location.origin);
  const estCode = memeOrigine && /\.(js|css|html|webmanifest)(\?|$)/.test(req.url);
  if (estCode) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // Cache d'abord pour le reste (images, polices, icônes).
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && memeOrigine) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
