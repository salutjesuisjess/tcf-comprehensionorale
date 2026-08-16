/* ═══ Service Worker — TCF Canada / Compréhension Orale ═══
   Objetivo:
   1) Deixar o app (HTML/CSS/JS) abrir offline depois da 1ª visita.
   2) Guardar em cache os áudios/imagens do Firebase Storage à medida
      que o usuário for ouvindo/vendo — assim, questões já acessadas
      uma vez tocam de novo sem internet.
   3) NUNCA cachear tráfego do Firestore/Auth (login e sincronização de
      progresso continuam exigindo internet, como já era o caso). */

const VERSION = 'v1';
const SHELL_CACHE = `tcf-co-shell-${VERSION}`;
const MEDIA_CACHE = `tcf-co-media-${VERSION}`;
const STATIC_CACHE = `tcf-co-static-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, MEDIA_CACHE, STATIC_CACHE];

// Arquivos do "app shell" — o essencial pra tela abrir sem rede.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isMediaHost(url) {
  return url.hostname === 'firebasestorage.googleapis.com';
}

function isStaticCdnHost(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'www.gstatic.com'
  );
}

function isRealtimeBackendHost(url) {
  // Login (Firebase Auth) e sincronização de progresso (Firestore):
  // deixa passar direto pra rede, nunca guarda em cache.
  return (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')
  );
}

// cache-first: usa o que já tem salvo; só busca na rede se não tiver.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Requests pro Firebase Storage feitas por <audio>/<img> costumam
    // vir como "opaque" (sem CORS) — ainda dá pra guardar em cache.
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

// network-first: tenta buscar a versão mais nova; se estiver offline,
// cai pro que tiver em cache (garante que o app sempre abre).
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || cache.match('./index.html');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Nunca mexe em métodos que não sejam GET (login, salvar progresso, etc.)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isRealtimeBackendHost(url)) return; // deixa passar direto

  if (isMediaHost(url)) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  if (isStaticCdnHost(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});
