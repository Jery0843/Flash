const CACHE_NAME = 'flash-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Handle share target POST requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (event.request.method === 'POST' && url.pathname === '/receive-share') {
    event.respondWith(Response.redirect('/create?share=true', 303));
    
    event.waitUntil(async function() {
      const data = await event.request.formData();
      const files = data.getAll('files');
      
      // We'll wait for a client to be ready and send the files
      // A more robust way is to use a broadcast channel or a shared state
      const waitForClientAndSend = async () => {
        let attempts = 0;
        while (attempts < 20) {
          const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          const client = clients.find(c => new URL(c.url).pathname === '/create');
          
          if (client) {
            client.postMessage({
              type: 'SHARE_TARGET_FILES',
              files: files
            });
            return;
          }
          
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }
      };
      
      await waitForClientAndSend();
    }());
    return;
  }
});

// Handle notification clicks to focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});

// Keep the service worker alive during transfers
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'KEEP_ALIVE') {
    // console.log('[SW] Keep alive received');
  }
});
