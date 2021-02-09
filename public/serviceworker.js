
self.addEventListener('push', function (event) {
    if (event.data == null) return;
    var json = event.data.json();
    const options = { body: json.body, icon: '/favicon-303x303.png', tag: json.url };
    if (json.icon) { options.icon = '/images/notify/icons128-' + json.icon + '.png'; }
    self.registration.showNotification(json.title, options);
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    if ((event.notification.tag != null) && (event.notification.tag != '')) { event.waitUntil(self.clients.openWindow(event.notification.tag)); }
});