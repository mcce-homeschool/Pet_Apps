// sw.js — app-shell cache so the Receipts app installs as a PWA and works
// offline. Same cache-first posture as KennelOS; bump CACHE_NAME whenever any
// precached file changes so installed clients roll over.
//
// Strategy note: the app SHELL (small — html/js/css/icons/dexie) is precached on
// install so the app opens instantly offline. The vendored Tesseract OCR assets
// (~7 MB) are deliberately NOT precached — they are runtime-cached on first scan
// by the fetch handler below, so install stays fast/reliable and OCR still works
// offline after you've scanned once. If you change those files, bump CACHE_NAME.
const CACHE_NAME = 'receipts-shell-v8';

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'app.js',
  'assets/app.css',
  'assets/ui.js',
  'assets/pdfView.js',
  'data/db.js',
  'data/vocab.js',
  'data/entryRepo.js',
  'data/photoRepo.js',
  'data/settings.js',
  'data/csvExport.js',
  'data/ocr.js',
  'data/zip.js',
  'data/backup.js',
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

// Cache-first for same-origin GETs, runtime-caching anything new (incl. the
// Tesseract assets on first scan). Cross-origin / non-GET fall through.
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
