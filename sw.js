/* Mr. Guitar POS service worker.
 *
 * Strategy, and why:
 *   App code (HTML/JS/CSS) is NETWORK FIRST with a short timeout. A till must
 *   never be stranded on an old build after a deploy — that is worth a few
 *   hundred milliseconds. When the network is slow or gone, the cached copy is
 *   served instead, so the shop still opens with no internet.
 *
 *   Everything else (icons, CDN libraries) is CACHE FIRST, because those files
 *   are versioned or never change.
 *
 *   Firebase traffic is never cached — the app has its own offline queue.
 */

const VERSION = 'v2.2.0';
const SHELL_CACHE = `mrguitar-shell-${VERSION}`;
const NET_TIMEOUT = 3000;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/auth.js',
  './js/store.js',
  './js/util.js',
  './js/firebase.js',
  './js/pos.js',
  './js/receipt.js',
  './js/share.js',
  './js/inventory.js',
  './js/sales.js',
  './js/reports.js',
  './js/customers.js',
  './js/repairs.js',
  './js/rentals.js',
  './js/expenses.js',
  './js/admin.js',
  './icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll rejects the whole install if any single file 404s, so add individually.
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** One of our own source files, where freshness beats speed. */
function isAppCode(url) {
  if (url.origin !== self.location.origin) return false;
  return /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');
}

/** Network first, falling back to cache on error or when the network is too slow. */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NET_TIMEOUT))
    ]);
    if (response && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./')) || fetch(request);
    }
    return fetch(request);
  }
}

/** Cache first, refreshed quietly in the background. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const update = fetch(request).then(response => {
    if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);

  return cached || update;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase and analytics endpoints always go straight to the network.
  if (/(firebaseio|googleapis|google-analytics|firebaseinstallations)\.com$/.test(url.hostname)) return;

  event.respondWith(isAppCode(url) ? networkFirst(request) : cacheFirst(request));
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearCaches') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});
