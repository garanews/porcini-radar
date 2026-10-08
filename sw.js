// Service worker: keeps the app available offline, in the woods with no signal.
// The AI model does not go through here: WebLLM stores it in the browser cache by itself.
const VERSION = 'v6';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'i18n.js',
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

// App files only: network first (to get updates), cache when there is no signal.
// `no-cache` revalidates with the server, so an update never mixes old and new files.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
