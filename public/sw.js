// Minimaler Service Worker, damit die App installierbar ist ("Zum Home-Bildschirm").
// Kein Offline-Cache: das Spiel braucht ohnehin die Live-Verbindung zum Server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
