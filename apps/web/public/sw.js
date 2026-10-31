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
