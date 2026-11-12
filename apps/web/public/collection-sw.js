/* Only the public Driver shell and versioned code are cached. Never cache API data. */
const DRIVER_CACHE = 'collection-driver-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const publicShell = url => url.origin === self.location.origin && (url.pathname === '/collection/driver' || url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/collection-icons/'));
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_DRIVER_SHELL' || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls)].slice(0,100).map(path => new URL(path,self.location.origin)).filter(publicShell).map(url=>url.href);
  event.waitUntil(caches.open(DRIVER_CACHE).then(cache => Promise.allSettled(urls.map(url => cache.add(url)))));
});
const offline = () => new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Collection</title><body style="font:18px system-ui;padding:32px"><h1>Нет подключения</h1><p>Подключитесь к интернету и откройте Collection снова.</p><button onclick="location.reload()">Повторить</button></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
self.addEventListener('fetch', event => {
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/collection-icons/')){
    event.respondWith(caches.open(DRIVER_CACHE).then(async cache=>{const saved=await cache.match(request);if(saved)return saved;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}));return;
  }
  if(request.mode!=='navigate'||!url.pathname.startsWith('/collection'))return;
  event.respondWith((async()=>{try{const response=await fetch(request);if(url.pathname==='/collection/driver'&&response.ok){const cache=await caches.open(DRIVER_CACHE);await cache.put('/collection/driver',response.clone());}return response;}catch{if(url.pathname==='/collection/driver'){const cached=await caches.match('/collection/driver');if(cached)return cached;}return offline();}})());
});
