// Garde l'appli disponible hors connexion. Les données (GitHub) et la météo passent toujours par le réseau.
const CACHE = "dressing-app-v1.3.3";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "js/catalog.js", "js/engine.js", "js/store.js", "js/github.js", "js/weather.js", "js/camera.js", "js/styles.js", "js/ai.js", "js/guess.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("dressing-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com";
  if (!sameOrigin && !fonts) return; // GitHub, météo : réseau direct
  if (sameOrigin && url.pathname.endsWith("version.json")) return; // toujours le réseau

  // réseau d'abord pour avoir la dernière version, cache si hors ligne
  e.respondWith(
    // « no-cache » : on redemande toujours au serveur s'il y a plus récent (sinon l'iPhone garde l'ancienne version)
    fetch(sameOrigin ? (e.request.mode === "navigate" ? new Request(e.request.url, { cache: "no-cache" }) : new Request(e.request, { cache: "no-cache" })) : e.request).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
