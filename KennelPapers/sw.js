// sw.js — app-shell cache so Kennel Papers installs as a PWA and works
// offline. Same cache-first posture as KennelOS/Receipts. Unlike Receipts
// (which runtime-caches its ~7 MB OCR engine), Kennel Papers has no large
// vendored asset, so the WHOLE shell precaches on install.
//
// Discipline (guide §11, §15.5): any app file added/renamed/removed/edited
// => (1) update PRECACHE_URLS and (2) bump CACHE_NAME. cache.addAll is
// atomic — one wrong path fails the whole install and silently breaks
// offline.
const CACHE_NAME = 'kennelpapers-shell-v1';

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'app.js',
  'assets/app.css',
  'assets/ui.js',
  'data/db.js',
  'data/vocab.js',
  'data/settings.js',
  'data/dogRepo.js',
  'data/documentRepo.js',
  'data/fileRepo.js',
  'data/dogImport.js',
  'data/pdfBuild.js',
  'data/dropbox.js',
  'data/backup.js',
  'data/zip.js',
  'vendor/dexie.min.mjs',
  'assets/icons/favicon-32.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GETs. Dropbox requests are cross-origin and
// non-GET, so they fall through untouched — this handler never intercepts
// the backup push/pull traffic.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
