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
      
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Wait for the new window to be ready
      let client;
      if (clients.length > 0) {
        client = clients[0];
      } else {
        // This case shouldn't really happen with the redirect above but just in case
        return;
      }

      // We need to wait a bit for the page to load and register its message listener
      // Alternatively, we store files in IndexedDB and the page picks them up
      // For now, let's try a simple message with a retry or use a reliable store
      const sendFiles = async (attempts = 0) => {
        if (attempts > 10) return;
        client.postMessage({
          type: 'SHARE_TARGET_FILES',
          files: files
        });
        // Check if acknowledged? For simplicity, we'll just try once or use IndexedDB
      };
      
      // Let's use a small delay to ensure the page is ready
      setTimeout(() => sendFiles(), 1000);
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
