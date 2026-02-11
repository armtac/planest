/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{
    url: string;
    revision: string | null;
  }>;
};

precacheAndRoute(self.__WB_MANIFEST);
self.skipWaiting();
clientsClaim();

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload: {
    title?: string;
    body?: string;
    url?: string;
    page?: string;
    date?: string;
    eventId?: string;
  } = {};

  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title ?? 'Planest Reminder';
  const body = payload.body ?? 'Hai un promemoria.';
  const url = payload.url ?? '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: payload.eventId ? `event-${payload.eventId}` : undefined,
      data: {
        url,
        page: payload.page ?? 'calendar',
        date: payload.date ?? null,
        eventId: payload.eventId ?? null,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as {
    url?: string;
    page?: string;
    date?: string | null;
    eventId?: string | null;
  };

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (allClients.length > 0) {
        const client = allClients[0];
        client.postMessage({
          type: 'PLANEST_NAVIGATE',
          payload: {
            page: data.page ?? 'calendar',
            date: data.date ?? null,
            eventId: data.eventId ?? null,
          },
        });
        await client.focus();
        return;
      }

      await self.clients.openWindow(data.url ?? '/');
    })(),
  );
});
