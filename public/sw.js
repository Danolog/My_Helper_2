/// Service Worker for Push Notifications - MyHelper

// Install event - activate immediately
self.addEventListener("install", (event) => {
  console.log("[SW] Service worker installed");
  event.waitUntil(self.skipWaiting());
});

// Activate event - claim all clients
self.addEventListener("activate", (event) => {
  console.log("[SW] Service worker activated");
  event.waitUntil(self.clients.claim());
});

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
    notificationUrl = data.data.url;
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
  const urlToOpen = event.notification.data?.url || "/appointments";
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
