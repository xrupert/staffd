/* STAFFD service worker — Phase 7 PWA + Push.
 *
 * Minimal scope by design:
 *   • install  — skip waiting so updates take effect immediately
 *   • activate — claim open clients
 *   • push     — show notification from payload
 *   • notificationclick — focus an existing tab or open the target URL
 *
 * No fetch caching today. Offline support is a follow-up; the goal of this
 * worker is to make STAFFD installable + push-capable, not to serve assets
 * offline. Adding a cache layer later is additive.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "STAFFD", body: "Update from your staff." };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      try { payload.body = event.data.text(); } catch { /* fall through */ }
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/logo-light.png",
    badge: "/logo-light.png",
    tag: payload.tag || "staffd",
    data: { url: payload.url || "/dashboard" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      // Focus an existing tab that already has STAFFD open.
      for (const client of all) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            return client.focus().then(() => {
              if ("navigate" in client) {
                return client.navigate(target).catch(() => undefined);
              }
              return undefined;
            });
          }
        } catch { /* skip malformed url */ }
      }
      // Otherwise open a fresh tab.
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return undefined;
    })
  );
});
