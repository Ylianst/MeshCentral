# SSL/Letsencrypt

## MeshCentral supports SSL using self generated certs, your own certs or Letsencrypt

### Enabling letsencrypt

Make sure you match and/or adjust all the following settings appropriately in your config.json file:

```json
{
    "settings": {
        "redirPort"
        "cert": "yourdomain.com"
    },
    "domains": {
        "letsencrypt": {
        "__comment__": "Requires NodeJS 8.x or better, Go to https://letsdebug.net/ first before trying Let's Encrypt.",
        "email": "myemail@myserver.com",
        "names": "myserver.com,customer1.myserver.com",
        "skipChallengeVerification": false,
        "production": true
        },
    }
}
```

If you need further clarification to know what each of these settings are, check out [the config schema](https://github.com/Ylianst/MeshCentral/blob/master/meshcentral-config-schema.json).

Then restart meshcentral and it will get a cert for you, the process will need to restart to apply the cert.

### Useful resources/troubleshooting

To check letsencrypt is working properly please use https://letsdebug.net/. We are using the [HTTP-O1 challenge](https://letsencrypt.org/docs/challenge-types/#http-01-challenge) method with these instructions.

Also make sure you have port 80 open and pointing to your meshcentral server, **IT WILL NOT WORK** if port 80 isn't open and it **HAS** to be port 80.

You can read more about Letsencrypt and meshcentral [here](https://ylianst.github.io/MeshCentral/meshcentral/#lets-encrypt-support). 
