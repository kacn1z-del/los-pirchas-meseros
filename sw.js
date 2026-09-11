// Service worker mínimo — necesario para que el navegador ofrezca instalar
// la página como app. No intenta cachear todo el sitio (eso complicaría
// los datos en tiempo real de Firestore); solo deja pasar las peticiones
// normalmente y cachea los archivos estáticos básicos para que el ícono
// y el manifest carguen rápido incluso con mala señal.
const CACHE = 'pirchas-v1'
const ARCHIVOS_BASICOS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS_BASICOS).catch(() => {}))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Todo lo que no sea GET (o vaya a Firestore/APIs) se deja pasar tal cual.
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Actualiza el caché en segundo plano con la copia más nueva.
        const copia = res.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copia)).catch(() => {})
        return res
      })
      .catch(() => caches.match(event.request))
  )
})
