const CACHE = 'planet-uncharted-ct-v1';
const SHELL = [
  '/guide/',
  '/guide/index.html',
  '/photos/hero-aerial.jpg',
  '/photos/Signal-Hill.webp',
  '/photos/llandudno-beach.jpg',
  '/photos/wine-barrel.jpeg',
  '/photos/dirk-lions-head.jpeg',
  '/photos/woodstock.webp',
  '/photos/neighbourgoods-market.jpg',
  '/photos/bree-street.jpg',
  '/photos/caipy-avatar.png',
  '/photos/table-mountain.jpeg',
  '/photos/robben-island.jpeg',
  '/photos/boulders-beach.jpeg',
  '/photos/Cape-Point.webp',
  '/photos/bo-kaap.webp',
  '/photos/waterfront.jpeg',
  '/photos/chapmans-peak.jpeg',
  '/photos/winelands.webp',
  '/photos/camps-bay.webp',
  '/photos/Hout-Bay.webp',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Network-only for live API calls
  if (url.includes('open-meteo.com') || url.includes('frankfurter.app') || url.includes('mapbox') || url.includes('elevenlabs') || url.includes('onrender.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    }).catch(() => caches.match('/guide/index.html'))
  );
});
