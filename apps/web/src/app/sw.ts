import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  const pushEvent = event as PushEvent;
  let payload: PushPayload = {};
  try {
    payload = (pushEvent.data?.json() as PushPayload) ?? {};
  } catch {
    payload = {};
  }
  const title = payload.title ?? 'TakApp';
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/icon.svg',
    tag: payload.tag ?? title,
    data: { url: payload.url ?? '/' },
  };
  pushEvent.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const clickEvent = event as NotificationEvent;
  clickEvent.notification.close();
  const url = ((clickEvent.notification.data as { url?: string } | undefined)?.url) ?? '/';
  clickEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
