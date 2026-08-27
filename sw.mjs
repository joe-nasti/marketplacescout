const NETWORK_FIRST_EXT=/\.(?:js|mjs|css|html|webmanifest)$/i;
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())await caches.delete(key);await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  const isAppAsset=NETWORK_FIRST_EXT.test(url.pathname)||url.pathname.endsWith('/')||url.pathname===new URL('./',self.location.href).pathname;
  if(!isAppAsset)return;
  event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>fetch(req)));
});
