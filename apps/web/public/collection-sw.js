/* Private application data is never cached by this worker. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || !new URL(event.request.url).pathname.startsWith('/collection')) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Collection</title><body style="font:18px system-ui;padding:32px"><h1>Нет подключения</h1><p>Подключитесь к интернету и откройте Collection снова.</p><button onclick="location.reload()">Повторить</button></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
