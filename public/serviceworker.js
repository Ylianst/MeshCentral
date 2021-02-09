
// "BMWzSl5zZPWw_lAKVvQb8NZBQwCs83jQJc68cj04yQTYt_kAIvuCMte0wU7BXjODXuGn8ut5qwU0pR_44dZuAmQ"

self.addEventListener('install', event => {
    console.log('Service Worker install', event);
});


// This will be called only once when the service worker is activated.
self.addEventListener('activate', async() => {
try {
        const applicationServerKey = urlB64ToUint8Array('BMWzSl5zZPWw_lAKVvQb8NZBQwCs83jQJc68cj04yQTYt_kAIvuCMte0wU7BXjODXuGn8ut5qwU0pR_44dZuAmQ')
        const options = { applicationServerKey, userVisibleOnly: true }
        const subscription = await self.registration.pushManager.subscribe(options)
        console.log(JSON.stringify(subscription))
    } catch (err) {
        console.log('Error', err)
    }
})

self.addEventListener('push', function (event) {
    console.log('Service Worker push', event);
    if (event.data) {
        console.log("Push event!! ", event.data.text());
        showLocalNotification("Yolo", event.data.text(), self.registration);
    } else {
        console.log("Push event but no data");
    }
});


self.addEventListener('message', function(event) {
    console.log('Service Worker message', event);
    if (isObject(event.data)) {
        if (event.data.type === 'sync') {
            // in this way, you can decide your tag
            //const id = event.data.id || uuid()
            // pass the port into the memory stor
            //syncStore[id] = Object.assign({ port: event.ports[0] }, event.data)
            //self.registration.sync.register(id)
        }
    }
})

self.addEventListener('sync', function(event) {
    console.log('Service Worker sync', event);
})

const showLocalNotification = function(title, body, swRegistration) {
  const options = {
    body
    // here you can add more properties like icon, image, vibrate, etc.
  };
  swRegistration.showNotification(title, options);
};

// Used to convert Base64 public VAPID key to bytearray.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
}