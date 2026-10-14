/*
 * TRIPLY offline support (roadmap phase 2). Hand-written, no framework.
 *
 * - Built assets (/_next/static, hashed and immutable) and media: cache first.
 * - Trip pages and the data they need (the trip, its expenses, the signed-in user, the trips list):
 *   network first, falling back to the last copy when there's no connection.
 * - Everything else goes straight to the network. Writes are never cached; the app queues
 *   went/skipped marks itself (lib/offline.ts) and syncs them when the connection is back.
 *
 * The data cache holds the signed-in user's own trips, so the app clears it on logout
 * (postMessage({ type: "clear" })).
 */
const VERSION = "v1";
const STATIC = `triply-static-${VERSION}`;
const DATA = `triply-data-${VERSION}`;
const MEDIA_MAX = 300;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (!key.endsWith(VERSION)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear") event.waitUntil(caches.delete(DATA));
});

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DATA_API = [new RegExp(`^/api/v1/trips/${UUID}(/expenses)?$`), /^\/api\/v1\/users\/me$/, /^\/api\/v1\/trips$/];
const PAGES = [/^\/trips(\/|$)/];

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith("/_next/static/")) return event.respondWith(cacheFirst(req, STATIC));
  if (path.startsWith("/media/")) return event.respondWith(cacheFirst(req, STATIC, MEDIA_MAX));
  if (DATA_API.some((r) => r.test(path))) return event.respondWith(networkFirst(req, DATA));
  // Trip pages: the HTML on a full load, and the RSC payload on in-app navigation.
  if (PAGES.some((r) => r.test(path)) && (req.mode === "navigate" || req.headers.get("RSC") === "1")) return event.respondWith(networkFirst(req, DATA));
});

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    await cache.put(req, res.clone());
    if (max) trim(cache, max);
  }
  return res;
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) if (new URL(k.url).pathname.startsWith("/media/")) await cache.delete(k);
}
