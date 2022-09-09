# SSL/Letsencrypt

## MeshCentral supports SSL using self generated certs, your own certs or Letsencrypt

### To enable Letsencrypt do the following in your config.json file:

1. Under Settings, change `"_redirPort"` to `"redirPort"` and `"_cert" to `"cert": "yourdomain.com",
2. Under letsencrypt change `"_letsencrypt"` to `"letsencrypt"`, enter your email address at `"email"` and yourdomain.com for `"names"` and change `"production"` to true.
3. Restart meshcentral and it will get a cert for you, the process will need to restart to apply the cert.

### Useful resources/troubleshooting

To check letsencrypt is working properly please use https://letsdebug.net/

Also make sure you have port 80 open and pointing to your meshcentral server, IT WILL NOT work if port 80 isnt open and it HAS to be port 80.

You can read more about Letsencrypt and meshcentral [here](https://ylianst.github.io/MeshCentral/meshcentral/#lets-encrypt-support). 
