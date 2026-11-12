/* Офлайн-оболочка: страница и шрифты открываются без интернета.
   Распознавание речи, конечно, требует связи. */

const CACHE = 'voice-ideas-v7';
const ASR_MODEL_CACHE = 'asr-model-v1';
const ASR_MODEL_PREFIX =
  'https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/main/';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './asr-worker.js',
  './fonts.css',
  './manifest.json',
  './models/gigaam/config.json',
  './models/gigaam/v3_vocab.txt',
  './models/vad/onnx/model_int8.onnx',
  './vendor/ort/ort-wasm-simd-threaded.mjs',
  './vendor/ort/ort-wasm-simd-threaded.wasm',
  './fonts/golos-cyrillic.woff2',
  './fonts/golos-latin.woff2',
  './fonts/lora-cyrillic.woff2',
  './fonts/lora-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('voice-ideas-') && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw _;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone());
      })
      .catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Проверка наличия файла (HEAD) должна работать и без интернета:
  // распознавание берёт модели и словарь из кэша.
  if (request.method === 'HEAD') {
    const headUrl = new URL(request.url);
    if (headUrl.origin === self.location.origin) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(request, { ignoreVary: true });
          if (cached) {
            return new Response(null, {
              status: cached.status,
              statusText: cached.statusText,
              headers: cached.headers,
            });
          }
          try {
            return await fetch(request);
          } catch (_) {
            return new Response(null, { status: 503 });
          }
        })()
      );
    }
    return;
  }

  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Большая модель распознавания скачивается один раз и хранится
  // в отдельном кэше. Этот кэш не удаляется при обновлении приложения.
  if (request.url.startsWith(ASR_MODEL_PREFIX)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASR_MODEL_CACHE);
        const cached = await cache.match(request, { ignoreVary: true });
        return cached || fetch(request);
      })()
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  const networkFirstTypes = ['navigate', 'script', 'style'];
  if (
    request.mode === 'navigate' ||
    networkFirstTypes.includes(request.destination)
  ) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
