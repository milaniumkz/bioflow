self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(String(data.title || "Collection"), {
      body: String(data.body || "Есть новое рабочее событие"),
      icon: "/branding/icon-192.png",
      badge: "/branding/icon-192.png",
      tag: String(data.notificationId || "collection-event"),
      data: { url: new URL("/#notifications", self.location.origin).href },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL("/#notifications", self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: "collection:notification" });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
