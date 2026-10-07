// Service worker: tiene l'app disponibile offline, nel bosco senza campo.
// Il modello AI non passa di qui: WebLLM lo salva da sé nella cache del browser.
const VERSION = 'v2';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'radar.js',
  'db.js',
  'llm.js',
  'llm-worker.js',
  'vendor/web-llm.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Solo file dell'app: prima la rete (per avere gli aggiornamenti), se non c'è la cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
