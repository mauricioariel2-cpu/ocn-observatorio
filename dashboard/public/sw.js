// Service worker mínimo: permite instalar la app y abrirla sin conexión.
// Los datos de Supabase y los mapas siempre van a la red (nunca se cachean).
const CACHE = 'ocn-v3'
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

// Avisos sin cuenta (Web Push): el robot del OCN avisa cuando se cae la compañía elegida en la región elegida.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'OCN', body: e.data?.text() } }
  e.waitUntil(self.registration.showNotification(d.title || 'OCN · Posible caída', {
    body: d.body || '', tag: d.tag || 'ocn', icon: `${BASE}icon-192.png`, badge: `${BASE}icon-192.png`,
    data: { url: d.url || BASE }, renotify: true,
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || BASE
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => x.url.startsWith(self.location.origin))
    if (w) { w.navigate(url); return w.focus() }
    return self.clients.openWindow(url)
  }))
})
