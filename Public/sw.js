// Service worker minimal — sert uniquement à rendre l'app installable
// et éligible comme cible de partage Android. Pas de cache hors-ligne pour l'instant.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
