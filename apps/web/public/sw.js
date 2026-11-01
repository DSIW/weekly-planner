// Keeps the app shell available offline. Pages try the network first and fall back to the last copy;
// static files are served from the cache and refreshed in the background. API calls are never cached:
// the plan is shared between two people, so actions need the network.
const CACHE = "weekly-planner-shell-v1";
const scope = new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(scope)) return;
  if (url.pathname.startsWith(`${scope}api/`)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(scope, copy));
          return res;
        })
        .catch(() => caches.match(scope).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? refresh;
    }),
  );
});

// A reminder from the server: shown even while the app is closed. Tapping it opens the app, or brings it forward.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Wochenplan", {
      body: data.body || "",
      icon: `${scope}icon-192.png`,
      tag: "finalize-reminder",
      data: { url: data.url || scope },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || scope, location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      const ours = open.find((c) => new URL(c.url).pathname.startsWith(scope));
      return ours ? ours.focus() : clients.openWindow(target);
    }),
  );
});
