// Offline-first cache.
// - App files: served from the cache immediately (fast start even on a weak
//   signal), then refreshed in the background so the next launch is up to date
//   (stale-while-revalidate).
// - Libraries from CDNs (pdf.js, Claude SDK): cache-first; their URLs are versioned.
// - Everything else (APIs) goes straight to the network.
const CACHE = 'her-shadowing-v8';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/core.js', 'js/ui.js', 'js/view-home.js', 'js/view-scene.js', 'js/view-study.js',
  'js/view-settings.js', 'js/view-talk.js', 'js/view-favs.js', 'js/parser.js', 'js/content.js', 'js/player.js', 'js/tts.js',
  'js/dict.js', 'js/motivate.js', 'js/recorder.js', 'js/translate.js', 'js/claude.js', 'js/speed.js',
];
const CDN_HOSTS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net']);

self.addEventListener('install', (e) => {
  // Cache what we can; a single missing file must not block installation.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const putCopy = (req, res) => {
  if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
  return res;
};

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (CDN_HOSTS.has(url.hostname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => putCopy(e.request, res))));
    return;
  }
  if (url.origin !== location.origin) return;

  // Navigations map to the cached app page regardless of the #hash or query.
  const key = e.request.mode === 'navigate' ? new Request('./') : e.request;
  e.respondWith(caches.match(key, { ignoreSearch: true }).then((hit) => {
    const network = fetch(e.request).then((res) => putCopy(key, res)).catch(() => null);
    if (hit) {
      e.waitUntil(network); // refresh in the background
      return hit;
    }
    return network.then((res) => res || new Response('오프라인이에요. 한 번 온라인에서 열어주세요.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }));
  }));
});
