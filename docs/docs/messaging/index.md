# Messaging

## Introduction

MeshCentral supports messaging platforms so that users can register a messaging account with MeshCentral and receive notifications. This is useful since messages are sent to an application the user is confirtable with and many messaging platforms have clients on mobile phones, desktop and more so that the notification can show up where the user is.

## Telegram Setup

Currently only Telegram is supported. You will need to provide MeshCentral with the necessary login information so that MeshCentral can authenticate and connect to the Telegram servers and start sending notifications. For Telegram, both user and bot login is supported with bot login being the more typical way to go. The configuration in the config.json for a bot login looks like this:

```json
{
  "settings": {
    "Cert": "devbox.mesh.meshcentral.com",
  },
  "domains": {
    "": {
      "title": "My Server"
    }
  },
  "messaging": {
    "telegram": {
      "apiid": 00000000,
      "apihash": "00000000000000000000000",
      "bottoken": "00000000:aaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

Note the "messaging" section in the config.json. For Telegram user login, it looks like this:

```json
{
  "messaging": {
    "telegram": {
      "apiid": 00000000,
      "apihash": "00000000000000000000000",
      "session": "aaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
}
```

User login makes use of "session", while bot login uses "bottoken". One way to get started with the setup is to run `node node_modules/meshcentral --setuptelegram` and follow the instructions.

![](images/MC2-Telegram5.png)

In the first step, you will get the apiid and apihash values. In the second step you get the bottoken or enter your phone number and code to get the session value. Once done, when running the server manually from the command line, the server should indicate that it can connect to Telegram like this:

```
MeshCentral HTTP redirection server running on port 80.
MeshCentral v1.0.87, Hybrid (LAN + WAN) mode.
MeshCentral Intel(R) AMT server running on central.mesh.meshcentral.com:4433.
MeshCentral HTTPS server running on central.mesh.meshcentral.com:443.
MeshCentral HTTPS relay server running on relay1.mesh.meshcentral.com:443.
MeshCentral Telegram client is bot connected.
```

Note the last line, indicating it's connected as a bot.

## User Setup

Once a messaging system is setup with MeshCentral, users will be able to register their handle and verify that they own that account by typing in a 6 digit code.

![](images/MC2-Telegram1.png)

This verification is necessary so that MeshCentral does not send notifications to incorrect messaging accounts.

## Administrator Management

When users setup a messaging account, a messaging bubble will show up next to their name in the "My Users" tab. You can also click on a user to see and edit it's messaging handle and message them. Currently MeshCentral can only send messages, no receive.

![](images/MC2-Telegram2.png)

## Messaging Two-Factor Authentication

By default, messaging is used as a second factor for login when a user enabled a messaging account. Users will need to messaging icon on the login screen and can opt to receive a 6 digit code to login.

![](images/MC2-Telegram3.png)

As an administrator you can turn off use of messaging for 2FA using the following settings in the config.json:

```json
{
  "settings": {
    "Cert": "devbox.mesh.meshcentral.com",
  },
  "domains": {
    "": {
      "title": "My Server",
	  "passwordRequirements": {
	    "msg2factor": false
	  }
    }
  }
}
```

Notice the `msg2factor` is set to false. In this case, messaging can still be used for user notifications, but will not be offered as a 2FA option.

For administrators, login reports will show if "Messaging" was used as a second factor for a user login. You can see this in this report:

![](images/MC2-Telegram4.png)