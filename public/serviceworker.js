
self.addEventListener('push', function (event) {
    console.log('Service Worker push', JSON.stringify(event));
    if (event.data) {
        console.log("Push event!! ", event.data.text());
        showLocalNotification("Yolo", event.data.text(), self.registration);
    } else {
        console.log("Push event but no data");
    }
});

const showLocalNotification = function(title, body, swRegistration) {
  const options = {
    body
    // here you can add more properties like icon, image, vibrate, etc.
  };
  swRegistration.showNotification(title, options);
};