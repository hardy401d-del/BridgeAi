// Service worker : installable, cible de partage Android, et mise en cache
// pour un usage hors ligne (app shell + librairies PDF/OCR/Puter).

const CACHE_NAME = 'bridgeai-cache-v2';

// Fichiers mis en cache dès l'installation, pour que l'app se charge hors ligne.
const APP_SHELL = [
  '/',
  '/index.html'
];

// Librairies externes utilisées par l'import PDF/capture d'écran et par Puter.js.
// Mises en cache au premier chargement réussi, puis servies depuis le cache
// ensuite — donc utilisables hors ligne après une première visite en ligne.
const RUNTIME_CACHE_HOSTS = [
  'cdnjs.cloudflare.com',
  'js.puter.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Librairies externes (PDF.js, Tesseract.js, Puter.js) : cache d'abord une fois
  // chargées, pour fonctionner hors ligne ensuite. Sinon on va sur le réseau et
  // on met en cache la réponse pour la prochaine fois.
  if (RUNTIME_CACHE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Navigation dans l'app (index.html) : réseau d'abord pour avoir la dernière
  // version, repli sur le cache si hors ligne.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)).catch(() => {});
        return response;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Tout le reste (dont les appels /api/... vers le backend) : réseau direct,
  // inchangé — on ne met jamais en cache les appels API.
  event.respondWith(fetch(event.request));
});
