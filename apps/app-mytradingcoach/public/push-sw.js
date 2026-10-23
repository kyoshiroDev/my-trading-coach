/*
 * Service worker de MyTradingCoach : notifications push SEULEMENT (#666).
 *
 * Aucun gestionnaire `fetch`, aucun cache : l'app n'est jamais servie depuis ce worker, un
 * déploiement ne peut pas laisser une ancienne version en place.
 *
 * Au clic, ouvre (ou met au premier plan) la page de la notification. L'adresse vient du serveur
 * mais elle est revérifiée ici : seulement un chemin interne de l'app, jamais une adresse externe.
 * Testé par `src/app/core/push/push-sw.spec.ts`.
 */

/** Chemin interne sûr (`/session`, `/profil#notifications`), sinon la racine. */
function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return url.pathname + url.search + url.hash;
  } catch (e) {
    return '/';
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'MyTradingCoach';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/logo-250.png',
      badge: '/logo-250.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      renotify: typeof data.tag === 'string',
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
      lang: 'fr',
      data: { url: safePath(data.url), settingsUrl: safePath(data.settingsUrl) },
      // Bouton affiché là où la plateforme le permet (pas sur iPhone).
      actions: [{ action: 'settings', title: 'Réglages' }],
    }),
  );
});

/** Met au premier plan une fenêtre de l'app sur `path`, sinon en ouvre une. */
async function openOrFocus(path) {
  const url = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const mine = windows.find((c) => new URL(c.url).origin === self.location.origin);
  if (mine) {
    await mine.focus();
    if ('navigate' in mine) {
      try {
        await mine.navigate(url);
        return;
      } catch (e) {
        // Fenêtre non contrôlée par ce worker : on en ouvre une.
      }
    } else {
      return;
    }
  }
  await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = safePath(event.action === 'settings' ? data.settingsUrl : data.url);
  event.waitUntil(openOrFocus(path));
});
