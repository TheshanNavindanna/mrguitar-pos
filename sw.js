/* Mr. Guitar POS service worker.
   App shell is cached so the till still opens with no internet; Firebase traffic
   is never cached (the app has its own offline queue for that). */

const VERSION = 'v2.1.0';
const SHELL_CACHE = `mrguitar-shell-${VERSION}`;

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
  './js/inventory.js',
  './js/sales.js',
  './js/reports.js',
  './js/customers.js',
  './js/repairs.js',
  './js/rentals.js',
  './js/expenses.js',
  './js/admin.js',
  './js/share.js',
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

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase / Google endpoints always go to the network.
  if (/(firebaseio|googleapis|google-analytics|firebaseinstallations|gstatic)\.com$/.test(url.hostname)
      && !url.pathname.endsWith('.js')) {
    return;
  }

  // Navigations: network first so a deployed update is picked up, cache as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Everything else: cache first, refresh in the background.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(c => c.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
