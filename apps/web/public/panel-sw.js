// Siparişin Önünde — işletme paneli service worker'ı (00 §10 alarm t=0 "ses + Web Push", 04 §4.5).
// Yalnız bildirim işler: önbellek, çevrimdışı sayfa ve fetch yakalama yoktur (panel her zaman ağdan yüklenir).
// Kayıt: components/push/push-client.ts → register('/panel-sw.js', { scope: '/panel/', updateViaCache: 'none' }).
// Yük (API services/push/send.ts): { kind, title, body, url, tag, orderId } — müşteri adı/telefonu/adresi yoktur.

'use strict';

const PANEL_URL = '/panel';

self.addEventListener('install', () => {
  // Yeni sürüm beklemeden devreye girsin (sayfa önbelleği olmadığı için güvenli)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch (_err) {
    return { body: event.data.text() };
  }
}

/** Yalnız bu kökene ait yol ("/panel…"); "//alan" ya da "/\\alan" gibi başka kökene giden adresler kabul edilmez. */
function isSameOriginPath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return false;
  try {
    return new URL(url, self.location.origin).origin === self.location.origin;
  } catch (_err) {
    return false;
  }
}

self.addEventListener('push', (event) => {
  const data = readPayload(event);
  const isOrder = data.kind !== 'test';
  const title = typeof data.title === 'string' && data.title ? data.title : 'Yeni sipariş';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    // Aynı siparişin bildirimi yenisiyle değişir; renotify ile yine sesli/titreşimli uyarır
    tag: typeof data.tag === 'string' && data.tag ? data.tag : 'siparis',
    renotify: true,
    // Sipariş bildirimi dokunulana kadar ekranda kalır (masaüstü Chrome/Edge; mobilde sistem belirler)
    requireInteraction: isOrder,
    icon: '/icon.svg',
    lang: 'tr',
    dir: 'ltr',
    vibrate: isOrder ? [300, 120, 300, 120, 300] : [120],
    timestamp: Date.now(),
    data: { url: isSameOriginPath(data.url) ? data.url : PANEL_URL, orderId: data.orderId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/** Pencere panel mi: /panel, /panel/… ya da panel.<alan adı> kökü. */
function isPanelClient(client) {
  try {
    const u = new URL(client.url);
    if (u.origin !== self.location.origin) return false;
    return u.pathname === PANEL_URL || u.pathname.startsWith(PANEL_URL + '/') || (u.hostname.startsWith('panel.') && u.pathname === '/');
  } catch (_err) {
    return false;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || PANEL_URL, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Açık panel varsa ona odaklan: kırmızı "YENİ SİPARİŞ" bandı her panel ekranında görünür
      const panel = windows.find(isPanelClient);
      if (panel && 'focus' in panel) {
        await panel.focus();
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Tarayıcı aboneliği yenilediğinde (anahtar/uç değişimi) sunucuya yeni aboneliği bildir; oturum çerezi gider.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription || null;
      if (!sub && event.oldSubscription && event.oldSubscription.options) {
        sub = await self.registration.pushManager.subscribe(event.oldSubscription.options);
      }
      if (!sub) return;
      await fetch('/api/v1/panel/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    })().catch(() => undefined),
  );
});
