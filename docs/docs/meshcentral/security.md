# Security

## Rate Limiting login attempts

You can use the MeshCentral Server Console with the command `badlogins` to see the current settings.

Adjust these items in your `config.json`

```json
"settings": {
    "_maxInvalidLogin": {
    "time": 10,
    "count": 10,
    "coolofftime": 10
    },
}
```

![](images/rate_limiting_logins.png)

## Disabling TLS 1.0/1.1 for AMT

```json
{
  "settings": {
    "mpshighsecurity": true
  }
}
```

## Duo 2FA setup

MeshCentral supports Duo as a way for users to add two-factor authentication and Duo offers free accounts for user 10 users. To get started, go to [Duo.com](https://duo.com/) and create a free account. Once logged into Duo, select "Applications" and "Protect an Application" on the left side. Search for "Web SDK" and hit the "Protect" button. You will see a screen with the following information:

 - Client ID
 - Client secret
 - API hostname

Copy these three values in a safe place and do not share these values with anyone. Then, in your MeshCentral config.json file, add the following in the domains section:

```json
{
  "domains": {
    "": {
      "duo2factor": {
        "integrationkey": "ClientId",
        "secretkey": "ClientSecret",
        "apihostname": "api-xxxxxxxxxxx.duosecurity.com"
      }
    }
  }
}
```

Restart MeshCentral and your server should now be Duo capable. Users will see an option to enable it in the "My Account" tab. When enabling it, users will be walked thru the process of downloading the mobile application and going thru a trial run on 2FA. Users that get setup will be added to your Duo account under the "Users" / "Users" screen in Duo. Note that the "admin" user is not valid in Duo, so, if you have a user with the name "Admin" in MeshCentral, they will get an error trying to setup Duo.
