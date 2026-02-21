/// Service Worker for MyHelper - Workbox Caching + Push Notifications

// ---------------------------------------------------------------------------
// 1. Load Workbox via CDN
// ---------------------------------------------------------------------------
importScripts(
  "https://storage.googleapis.com/workbox-cdn/releases/7.3.0/workbox-sw.js"
);

// ---------------------------------------------------------------------------
// 2. Cache version – bump this to invalidate all caches at once
// ---------------------------------------------------------------------------
const CACHE_VERSION = "v1";

// ---------------------------------------------------------------------------
// 3. Extract Workbox modules
// ---------------------------------------------------------------------------
const { precaching, routing, strategies, expiration, cacheableResponse } =
  workbox;

const { registerRoute, setCatchHandler } = routing;
const { CacheFirst, NetworkFirst, StaleWhileRevalidate } = strategies;
const { ExpirationPlugin } = expiration;
const { CacheableResponsePlugin } = cacheableResponse;

// ---------------------------------------------------------------------------
// 4. Install event – pre-cache the offline fallback page, then skipWaiting
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  console.log("[SW] Installing (Workbox)");
  event.waitUntil(
    caches
      .open(`pages-${CACHE_VERSION}`)
      .then((cache) => cache.add("/offline"))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// 5. Activate event – purge stale caches, then claim clients
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating (Workbox)");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !name.includes(CACHE_VERSION))
            .map((name) => {
              console.log("[SW] Deleting old cache:", name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// 6. Register caching routes
// ---------------------------------------------------------------------------

// 6a. Next.js static assets (/_next/static/)
registerRoute(
  ({ url }) => url.pathname.startsWith("/_next/static/"),
  new CacheFirst({
    cacheName: `static-assets-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// 6b. Google Fonts stylesheets
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new StaleWhileRevalidate({
    cacheName: `google-fonts-stylesheets-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 10 }),
    ],
  })
);

// 6c. Google Fonts webfont files
registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: `google-fonts-webfonts-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 365 days
      }),
    ],
  })
);

// 6d. Images
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: `images-${CACHE_VERSION}`,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
      }),
    ],
  })
);

// 6e. Safe GET /api/ requests (allowlist – only cache known public endpoints)
const CACHEABLE_API_PREFIXES = [
  "/api/salons",
  "/api/services",
  "/api/available-slots",
  "/api/health",
];

registerRoute(
  ({ request, url }) => {
    if (request.method !== "GET") return false;
    return CACHEABLE_API_PREFIXES.some((prefix) =>
      url.pathname.startsWith(prefix)
    );
  },
  new NetworkFirst({
    cacheName: `api-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes
      }),
    ],
  })
);

// 6f. Navigation requests (HTML pages)
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({
    cacheName: `pages-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 24 * 60 * 60, // 1 day
      }),
    ],
  })
);

// ---------------------------------------------------------------------------
// 7. Offline fallback – serve /offline for failed navigation requests
// ---------------------------------------------------------------------------
setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    const cache = await caches.open(`pages-${CACHE_VERSION}`);
    const cachedResponse = await cache.match("/offline");
    if (cachedResponse) return cachedResponse;
  }
  return Response.error();
});

// ---------------------------------------------------------------------------
// 8. Message handlers (SKIP_WAITING + CLEAR_CACHES)
// ---------------------------------------------------------------------------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Clear all caches on logout so no user-specific data persists
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((name) => caches.delete(name)))
      )
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Push Notification handlers (preserved from original)
// ---------------------------------------------------------------------------

/**
 * Validate notification URL — must be a relative path starting with /
 * to prevent open redirect attacks via push payloads.
 */
function sanitizeNotificationUrl(url) {
  if (typeof url !== "string") return "/appointments";
  // Must start with / but not // (protocol-relative URL)
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return "/appointments";
}

// Push event - show notification
self.addEventListener("push", (event) => {
  console.log("[SW] Push event received");

  let data = {
    title: "MyHelper",
    body: "Nowe powiadomienie",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "myhelper-notification",
    data: {},
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      console.error("[SW] Failed to parse push data:", e);
      data.body = event.data.text();
    }
  }

  // Build the URL to navigate to on click
  // If appointmentId is provided, link directly to the appointment detail page
  let notificationUrl = "/appointments";
  if (data.data && data.data.appointmentId) {
    notificationUrl = "/appointments/" + data.data.appointmentId;
  } else if (data.data && data.data.url) {
    notificationUrl = sanitizeNotificationUrl(data.data.url);
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || "appointment-reminder-" + (data.data && data.data.appointmentId || "general"),
    renotify: true,
    data: { ...data.data, url: notificationUrl },
    vibrate: [200, 100, 200],
    requireInteraction: true,
    actions: [
      { action: "open", title: "Zobacz wizyte" },
      { action: "close", title: "Zamknij" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click event - open the app and navigate to appointment
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked:", event.action);
  event.notification.close();

  if (event.action === "close") {
    return;
  }

  // Default action or "open" action - navigate to the appointment
  const urlToOpen = sanitizeNotificationUrl(event.notification.data?.url);
  const fullUrl = new URL(urlToOpen, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus and navigate it
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus().then((focusedClient) => {
              if (focusedClient && "navigate" in focusedClient) {
                return focusedClient.navigate(fullUrl);
              }
            });
          }
        }
        // Otherwise open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullUrl);
        }
      })
  );
});
