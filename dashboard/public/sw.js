// Service worker mínimo: permite instalar la app y abrirla sin conexión.
// Los datos de Supabase y los mapas siempre van a la red (nunca se cachean).
const CACHE = 'ocn-v2'
const BASE = new URL('./', self.location).pathname

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, `${BASE}index.html`])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Red primero; si no hay conexión, lo último guardado.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(`${BASE}index.html`))),
  )
})
