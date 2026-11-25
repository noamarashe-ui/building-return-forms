const CACHE = 'field-forms-v1.4.4';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'lib/xlsx.mini.min.js', 'lib/html2canvas.min.js', 'lib/jspdf.umd.min.js', 'lib/jszip.min.js',
  'fonts/heebo-hebrew-400-normal.woff2', 'fonts/heebo-hebrew-700-normal.woff2',
  'fonts/heebo-latin-400-normal.woff2', 'fonts/heebo-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).catch(() =>
      e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
