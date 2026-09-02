// Derive the app base from the worker's own URL so it works at the production
// root ("/") and under a sub-path like "/mybishbash-preview/" (staging/GitHub Pages),
// without hardcoding either. e.g. ".../service-worker.js" -> "/", and
// ".../mybishbash-preview/service-worker.js" -> "/mybishbash-preview/".
const APP_BASE = new URL("./", self.location).pathname;
const APP_BASE_SLUG = APP_BASE.replace(/^\/+|\/+$/g, "") || "root";
const SERVICE_WORKER_VERSION = "preview-2e41c631967315df7a3f166c5d0c0cb91113f614";
const CACHE_PREFIX = `mybishbash-${APP_BASE_SLUG}-`;
const LEGACY_CACHE_PREFIX = "bish" + "bash-";
const LEGACY_APP_BASE = "/" + "bish" + "bash/";
const HTML_CACHE = `${CACHE_PREFIX}html-${SERVICE_WORKER_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${SERVICE_WORKER_VERSION}`;
const MEDIA_CACHE = `${CACHE_PREFIX}media-${SERVICE_WORKER_VERSION}`;
const INDEX_URL = `${APP_BASE}index.html`;
let shouldClaimClients = false;

function debugLog() {}

const MEDIA_EXTENSIONS = [
  ".avif",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".webp",
  ".webmanifest",
];

self.addEventListener("install", (event) => {
  debugLog("[SERVICE_WORKER] install", { version: SERVICE_WORKER_VERSION, appBase: APP_BASE });
  event.waitUntil(
    caches
      .open(HTML_CACHE)
      .then((cache) =>
        fetch(INDEX_URL, { cache: "no-store" })
          .then((response) => {
            if (response.ok) return cache.put(INDEX_URL, response);
            return undefined;
          })
          .catch(() => undefined),
      )
  );
});

self.addEventListener("activate", (event) => {
  debugLog("[SERVICE_WORKER] activate", {
    version: SERVICE_WORKER_VERSION,
    appBase: APP_BASE,
    shouldClaimClients,
  });
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && ![HTML_CACHE, RUNTIME_CACHE, MEDIA_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => (shouldClaimClients ? self.clients.claim() : undefined)),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    shouldClaimClients = true;
    debugLog("[SERVICE_WORKER] skip waiting requested", { version: SERVICE_WORKER_VERSION, appBase: APP_BASE });
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "CLEAR_MYBISHBASH_CACHES") {
    event.waitUntil(clearMyBishBashCaches());
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE)) return;

  if (event.request.mode === "navigate" || acceptsHtml(event.request)) {
    event.respondWith(networkFirstHtml(event.request));
    return;
  }

  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  if (isScriptOrStyle(event.request)) {
    const fetchStrategy = isImmutableBuildAsset(url.pathname) ? cacheFirst : networkFirst;
    event.respondWith(fetchStrategy(event.request, RUNTIME_CACHE));
    return;
  }

  if (isCacheableMedia(url.pathname)) {
    event.respondWith(cacheFirst(event.request, MEDIA_CACHE));
  }
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  debugLog("[NOTIFICATIONS] Push received", data);

  event.waitUntil(
    self.registration.showNotification(data.title || "Tiny myBishBash moment?", {
      body: data.body || "Something you said mattered.",
      icon: `${APP_BASE}icons/mybishbash-cover.png`,
      badge: `${APP_BASE}icons/mybishbash-cover.png`,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = normalizeNotificationUrl(event.notification.data?.url);
  debugLog("[NOTIFICATIONS] Notification clicked", urlToOpen);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i += 1) {
        const client = windowClients[i];

        if ("focus" in client) {
          client.navigate?.(urlToOpen);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }

      return undefined;
    }),
  );
});

function normalizeNotificationUrl(rawUrl) {
  const fallback = new URL(`${APP_BASE}home`, self.location.origin);

  try {
    const url = new URL(rawUrl || fallback.toString(), self.location.origin);
    if (url.origin !== self.location.origin) return fallback.toString();

    if (url.pathname === APP_BASE || url.pathname === `${APP_BASE}index.html`) {
      const route = url.searchParams.get("route");
      if (route) {
        const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
        url.pathname = `${APP_BASE.replace(/\/$/, "")}${normalizedRoute}`;
        url.searchParams.delete("route");
      }
    }

    if (url.pathname.startsWith(LEGACY_APP_BASE)) {
      url.pathname = url.pathname.replace(LEGACY_APP_BASE, APP_BASE);
    }

    if (!url.pathname.startsWith(APP_BASE)) return fallback.toString();
    return url.toString();
  } catch (error) {
    console.warn("[NOTIFICATIONS] Invalid notification URL", rawUrl, error);
    return fallback.toString();
  }
}

async function networkFirstHtml(request) {
  const cache = await caches.open(HTML_CACHE);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cache.put(INDEX_URL, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(INDEX_URL)) || Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function clearMyBishBashCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)).map((key) => caches.delete(key)));
}

function acceptsHtml(request) {
  return request.headers.get("accept")?.includes("text/html");
}

function isScriptOrStyle(request) {
  return request.destination === "script" || request.destination === "style";
}

function isImmutableBuildAsset(pathname) {
  const assetsPrefix = `${APP_BASE}assets/`;
  return pathname.startsWith(assetsPrefix) && /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(pathname);
}

function isCacheableMedia(pathname) {
  return MEDIA_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}
