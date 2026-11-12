// lspf PWA service worker: the application works offline once installed.
// The version and the list of files are filled in by build.js (the cache name changes with the content).
const CACHE = 'lspf-pwa-e9e55be51372';
const FILES = ["./","index.html","app.css","lspf-bundle.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lspf-pwa-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Android "Share" -> lspf (manifest share_target, POST multipart): the shared files are kept in the cache
// SHARE, then the application is opened on ./?share=ID; main.js copies them into ~/partages and opens VIEW.
const SHARE = 'lspf-share';
async function receiveShare(req) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const form = await req.formData();
    const c = await caches.open(SHARE);
    let n = 0;
    for (const f of form.getAll('files')) {
      if (!f || typeof f === 'string') continue;
      const fileUrl = new URL(`./__share__/${id}/${n++}`, self.location.href).href;
      await c.put(fileUrl, new Response(f, {
        headers: {
          'X-Name': encodeURIComponent(f.name || ('partage' + n)),
          'Content-Type': f.type || 'application/octet-stream'
        }
      }));
    }
    if (!n) {   // shared text or link, without file: kept as a text file
      const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n');
      if (text) {
        const textUrl = new URL(`./__share__/${id}/0`, self.location.href).href;
        await c.put(textUrl, new Response(text + '\n', {
          headers: {
            'X-Name': 'partage-' + id + '.txt',
            'Content-Type': 'text/plain; charset=utf-8'
          }
        }));
      }
    }
  } catch (err) { /* nothing received: the application opens normally */ }
  const redirectUrl = new URL(`./?share=${id}`, self.location.href).href;
  return Response.redirect(redirectUrl, 303);
}

// Cache first (the files of a version never change), network for anything else
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && (url.pathname.endsWith('/share-target') || url.pathname.endsWith('/share-target/'))) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') : undefined);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
