/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string }>;
};

const CACHE_NAME = 'migravoice-v3';
const STATIC_CACHE = 'migravoice-static-v3';
const MEDIA_CACHE = 'migravoice-media-v3';
const PRECACHE_URLS = Array.from(
  new Set([
    '/',
    '/index.html',
    '/site.webmanifest',
    '/build.json',
    '/migra-logo-48.png',
    '/migra-logo-192.png',
    '/migra-logo-512.png',
    '/apple-touch-icon.png',
    '/sounds/ringtone.mp3',
    ...self.__WB_MANIFEST.map((entry) => entry.url),
  ])
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => ![CACHE_NAME, STATIC_CACHE, MEDIA_CACHE].includes(name)).map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'worker'
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          fetch(request)
            .then((response) => {
              if (response.ok) {
                cache.put(request, response.clone());
              }
            })
            .catch(() => undefined);
          return cached;
        }

        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  if (request.destination === 'image' || url.pathname.startsWith('/sounds/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }

        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', response.clone()));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || Response.error();
        })
    );
  }
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const notificationTitle = data.title || 'MigraVoice';
  const options: NotificationOptions & {
    actions?: Array<{ action: string; title: string }>;
    vibrate?: number[];
  } = {
    body: data.body || 'New notification',
    icon: '/migra-logo-192.png',
    badge: '/migra-logo-48.png',
    tag: data.tag || 'migravoice-notification',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: data.type === 'incoming_call',
  };

  if (data.type === 'incoming_call') {
    options.body = `Incoming call from ${data.callerName || data.callerNumber || 'Unknown'}`;
    options.actions = [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ];
    options.requireInteraction = true;
  }

  event.waitUntil(self.registration.showNotification(notificationTitle, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === 'answer') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'ANSWER_CALL', callId: data.callId });
          return clients[0].focus();
        }
        return self.clients.openWindow('/dialer');
      })
    );
    return;
  }

  if (event.action === 'decline') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) {
          clients[0].postMessage({ type: 'DECLINE_CALL', callId: data.callId });
        }
      })
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

export {};